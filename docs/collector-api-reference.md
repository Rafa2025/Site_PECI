# Collector — API Reference

## 1. Architecture Overview

The collector is a pipeline that triggers on-demand metric collection from physical and virtual infrastructure.
It is composed of the following components:

```
Client
  │
  ▼
FastAPI (argo-submit.py, port 8000)
  │  POST /submit
  │  Calls: argo submit --from=workflowtemplate/...
  ▼
Argo Workflows (v3.7.3, namespace: argo, pinned to control-plane node)
  │  WorkflowTemplate per source (namespace: monitoring)
  │  Fan-out: one k8s Job per KPI
  ▼
Telegraf Jobs (image: telegraf:1.30-alpine, ephemeral, namespace: monitoring)
  │  Renders telegraf.conf from ConfigMap template + env vars
  │  Runs for the requested duration then exits
  │
  ├──▶ InfluxDB v2  (http://10.255.32.83:8086, org: UA, bucket: monitoring)
  └──▶ Kafka        (10.255.32.83:9092)
```

**Infrastructure components:**

| Component | Role | Details |
|---|---|---|
| k3s | Kubernetes distribution running all workloads | Control-plane is the scheduling target for Argo |
| Argo Workflows | Orchestrates fan-out of Telegraf jobs | v3.7.3, `argo` namespace; controller and server pinned to control-plane via nodeSelector |
| Telegraf | Metric collection agent | `telegraf:1.30-alpine`; one ephemeral Job per KPI per collection run |
| InfluxDB v2 | Primary time-series store | `http://10.255.32.83:8086`, org `UA`, bucket `monitoring` |
| Kafka | Secondary streaming output | Broker `10.255.32.83:9092`; one topic per source/target/KPI |
| Grafana | Visualization layer | **Not present in this codebase. Not implemented.** |

**Shared storage:**

| Resource | Value |
|---|---|
| PersistentVolume | `telegraf-pv`, 1 Gi, hostPath `/mnt/data/telegraf` |
| PersistentVolumeClaim | `telegraf-pvc`, `monitoring` namespace, bound to `telegraf-pv` |

All Telegraf Jobs mount this PVC at `/data`.

**RBAC:** A single `Role` named `job-creator` and `RoleBinding` named `argo-job-creator` grant the `argo-telegraf` ServiceAccount permission to create, list, get, watch, and delete `batch/jobs` in the `monitoring` namespace. Each source directory ships an identical `rbac.yaml`.

---

## 2. Data Sources

Three sources are implemented. Each has its own Telegraf config template, runtime ConfigMap, and Argo WorkflowTemplate.

### 2.1 Proxmox

| Property | Value |
|---|---|
| Telegraf plugin | `inputs.http` |
| Protocol | HTTPS REST (Proxmox VE API) |
| Endpoint | `https://${PROXMOX_HOST}:8006/api2/json/nodes/${NODE}/qemu/${VM_ID}/status/current` |
| Auth | `Authorization: PVEAPIToken=${PROXMOX_TOKEN}` (from Secret `proxmox-credentials`, key `token`) |
| TLS verification | Disabled (`insecure_skip_verify = true`) |
| Data format | `json_v2` |
| Scrape interval | 3 s |
| Flush interval | 2 s |

The plugin extracts a single field per job run using the JSON path `data.${KPI_NAME}`, cast to `float`. One Telegraf Job is created per KPI.

### 2.2 Scaphandre

| Property | Value |
|---|---|
| Telegraf plugin | `inputs.prometheus` |
| Protocol | HTTP Prometheus scrape |
| Endpoint | `http://${SOURCE_HOST}:8080/metrics` |
| Auth | None |
| Filter | `namepass = ["${METRIC_NAME}"]` (one metric name per job) |
| Scrape interval | 10 s |
| Flush interval | 5 s |

The workflow shell script maps the human-readable KPI name to the exact Prometheus metric name (see §3.2) before rendering the Telegraf config. Tags `url`, `instance`, `job`, `value_source`, `cmdline`, `vm_id`, `socket_id`, `domain_id`, `domain_name`, and `exe` are excluded from the output.

### 2.3 PDU

| Property | Value |
|---|---|
| Telegraf plugin | `inputs.snmp` |
| Protocol | SNMP v1 |
| Endpoint | `${PDU_HOST}:161` |
| Community string | `it-atnog` |
| Timeout | 5 s, 2 retries |
| Scrape interval | 10 s |
| Flush interval | 5 s |

The SNMP config always queries two OID tables in a single run: per-outlet power and total power (see §3.3). The KPI name only affects the Kafka topic; both fields are always collected regardless of which KPI triggered the job.

---

## 3. KPIs Collected

### 3.1 Proxmox KPIs

Measurement name: `proxmox`

Each KPI is a separate field extracted from the Proxmox API response under `data.<kpi_name>`, type `float`.

| KPI name | Field in API | What it measures |
|---|---|---|
| `cpu` | `data.cpu` | CPU usage (fraction, 0–1) |
| `cpus` | `data.cpus` | Number of vCPUs allocated |
| `mem` | `data.mem` | Memory currently used (bytes) |
| `maxmem` | `data.maxmem` | Maximum memory allocated (bytes) |
| `disk` | `data.disk` | Disk space used (bytes) |
| `maxdisk` | `data.maxdisk` | Maximum disk space allocated (bytes) |
| `netin` | `data.netin` | Network bytes received (bytes, cumulative) |
| `netout` | `data.netout` | Network bytes sent (bytes, cumulative) |
| `diskread` | `data.diskread` | Disk bytes read (bytes, cumulative) |
| `diskwrite` | `data.diskwrite` | Disk bytes written (bytes, cumulative) |
| `uptime` | `data.uptime` | VM uptime (seconds) |
| `status` | `data.status` | VM run state (string: `running`, `stopped`, etc.) |

### 3.2 Scaphandre KPIs

Measurement name: matches the Prometheus metric name (e.g., `scaph_host_power_microwatts`).

The workflow maps each KPI label to a Prometheus metric name at runtime:

| KPI name | Prometheus metric name (`METRIC_NAME`) | Unit | What it measures |
|---|---|---|---|
| `host-power` | `scaph_host_power_microwatts` | µW | Total host power consumption |
| `host-energy` | `scaph_host_energy_microjoules` | µJ | Total host energy consumed |
| `socket-power` | `scaph_socket_power_microwatts` | µW | Power per CPU socket |
| `socket-energy` | `scaph_socket_energy_microjoules` | µJ | Energy per CPU socket |
| `domain-power` | `scaph_domain_power_microwatts` | µW | Power per RAPL power domain |
| `domain-energy` | `scaph_domain_energy_microjoules` | µJ | Energy per RAPL power domain |
| `proc-power` | `scaph_process_power_consumption_microwatts` | µW | Power consumption per process |
| `proc-cpu` | `scaph_process_cpu_usage_percentage` | % | CPU usage per process |
| `proc-mem` | `scaph_process_memory_bytes` | bytes | Resident memory per process |
| `proc-mem-virt` | `scaph_process_memory_virtual_bytes` | bytes | Virtual memory per process |
| `proc-disk-r` | `scaph_process_disk_read_bytes` | bytes/s | Disk read rate per process |
| `proc-disk-r-total` | `scaph_process_disk_total_read_bytes` | bytes | Cumulative disk bytes read per process |
| `proc-disk-w` | `scaph_process_disk_write_bytes` | bytes/s | Disk write rate per process |
| `proc-disk-w-total` | `scaph_process_disk_total_write_bytes` | bytes | Cumulative disk bytes written per process |

### 3.3 PDU KPIs

Measurement name: `pdu`

The SNMP config collects both fields in every job; the KPI name only determines the Kafka topic.

| KPI name | SNMP field name | OID | Unit | What it measures |
|---|---|---|---|---|
| `outlet-power` | `watts` | `1.3.6.1.4.1.534.6.6.7.6.5.1.3` | W (int) | Power draw per outlet |
| `total-power` | `total_watts` | `1.3.6.1.4.1.534.6.6.7.3.5.1.4` | W (int) | Total PDU power draw |

The outlet name is collected as a tag from OID `1.3.6.1.4.1.534.6.6.7.6.1.1.3` (field `outlet_name`). The SNMP index is also captured as a tag (`index_as_tag = true`). The PDU IP is recorded as the `pdu_ip` tag (`agent_host_tag = "pdu_ip"`).

---

## 4. How to Trigger a Collection

The FastAPI service (`argo-submit.py`) runs on port 8000 and exposes a single endpoint.

### Endpoint

```http
POST http://<api-host>:8000/submit
Content-Type: application/json
```

### Request Body

```json
{
  "targets": [
    {
      "source": "proxmox",
      "host": "<proxmox-ip>",
      "node": "<proxmox-node-name>",
      "target": "<vm-id>",
      "duration": 30
    },
    {
      "source": "scaphandre",
      "host": "<scaphandre-exporter-ip>",
      "target": "<machine-name>",
      "duration": 30
    },
    {
      "source": "pdu",
      "host": "<pdu-ip>",
      "duration": 30
    }
  ]
}
```

**Field reference:**

| Field | Type | Required | Description |
|---|---|---|---|
| `source` | string | yes | One of `proxmox`, `scaphandre`, `pdu` (case-insensitive) |
| `host` | string | source-dependent | Proxmox API host IP / Scaphandre exporter IP / PDU SNMP IP |
| `node` | string | Proxmox only | Proxmox node name (e.g., `pve`) |
| `target` | string | Proxmox/Scaphandre | VM ID (Proxmox) or machine name (Scaphandre). For PDU, it is accepted but not forwarded to the job. |
| `kpi` | string or array | — | **Accepted in the schema but ignored at runtime.** The API always collects all KPIs defined in `ALL_KPIS` for the source, regardless of this field. |
| `duration` | int | no | How long (seconds) each Telegraf job runs. Default: `30`. |

### What the API does internally

For each target, the API:

1. Looks up all KPIs for the source from `ALL_KPIS` (ignoring the `kpi` field if provided).
2. Builds one job descriptor per KPI, attaching source-specific fields (`vm_id` for Proxmox, `target` for Scaphandre, `target` for PDU).
3. Groups descriptors by source and calls `argo submit` once per source:

```bash
argo submit -n monitoring \
  --from=workflowtemplate/telegraf-<source>-jobs \
  --parameter=targets=<json-array> \
  --watch
```

The subprocess call has a 180-second timeout. `--watch` blocks until all jobs complete before returning.

**WorkflowTemplate names resolved by source:**

| Source | WorkflowTemplate name |
|---|---|
| `proxmox` | `telegraf-proxmox-jobs` |
| `scaphandre` | `telegraf-scaphandre-jobs` |
| `pdu` | `telegraf-pdu-jobs` |

### Example response

```json
{
  "status": "success",
  "submitted": 2,
  "results": [
    {
      "source": "proxmox",
      "status": "success",
      "workflow_name": "telegraf-proxmox-jobs",
      "targets_count": 12
    },
    {
      "source": "scaphandre",
      "status": "success",
      "workflow_name": "telegraf-scaphandre-jobs",
      "targets_count": 14
    }
  ]
}
```