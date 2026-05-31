# Stressmaster API Reference
## module-stresser — Stress Modules

> **Audience:** Internal — team / supervisor
> **Base URL:** `https://10.255.32.82:32746`
> **Auth:** Bearer token on every request
> **TLS:** Self-signed cert — use `-k` flag on curl

---

## Authentication

All requests require a Bearer token. The token is stored as a Kubernetes Secret and can be retrieved at any time from stressmaster:

```bash
kubectl get secret stress-ui-sa-token -n stress \
  -o jsonpath='{.data.token}' | base64 -d
```

Set it as an environment variable for convenience:

```bash
export ARGO="https://10.255.32.82:32746"
export ARGO_TOKEN=$(kubectl get secret stress-ui-sa-token -n stress \
  -o jsonpath='{.data.token}' | base64 -d)
export CALLBACK="http://<ui-vm-ip>:3000/api/callback"
```

Unauthorized request response:
```json
{"code": 16, "message": "token not found"}
```

---

## Module Overview

| Module | WorkflowTemplate | What it does |
|--------|-----------------|--------------|
| **CPU** | `cpu-stress-api` | Saturates CPU cores using stress-ng with configurable load %, worker count, duration, and CPU pinning via cpuset |
| **Memory** | `memory-stress-api` | Allocates and accesses memory at configurable size and rate using a custom memory stressor, with read/write MB/s throttling |
| **IO** | `io-stress-api` | Runs fio-based disk stress with configurable mode (sequential/random read/write), block size, IO depth, and throughput targets |
| **Network** | `network-stress-api` | Runs iperf3 against a target server with configurable bandwidth, protocol (TCP/UDP), and direction (upload/download) |

All modules:
- Run on a specific worker node via `target-node`
- Validate CPU/memory resources before spawning (CPU and memory modules only)
- Send an enriched callback on completion or failure
- Support `onExit` notify — callback fires regardless of outcome

---

## Operations

### 1. List workflows

Returns all workflows in the stress namespace, most recent first.

```bash
curl -sk "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}"
```

**Response:**
```json
{
  "items": [
    {
      "metadata": {
        "name": "cpu-ui-abc12",
        "namespace": "stress"
      },
      "status": {
        "phase": "Succeeded",
        "startedAt": "2026-05-14T10:00:00Z",
        "finishedAt": "2026-05-14T10:02:00Z"
      }
    }
  ]
}
```

---

### 2. Poll workflow status

Returns the current status of a specific workflow.

```bash
curl -sk "${ARGO}/api/v1/workflows/stress/<workflow-name>" \
  -H "Authorization: Bearer ${ARGO_TOKEN}"
```

**Response:**
```json
{
  "metadata": {
    "name": "cpu-ui-abc12"
  },
  "status": {
    "phase": "Running",
    "startedAt": "2026-05-14T10:00:00Z",
    "finishedAt": null,
    "message": ""
  }
}
```

**Possible phases:** `Pending` `Running` `Succeeded` `Failed` `Error`

---

### 3. Terminate a workflow

Stops a running workflow immediately. Pods are killed, callback still fires with `status: Failed`.

```bash
curl -sk -X PUT \
  "${ARGO}/api/v1/workflows/stress/<workflow-name>/terminate" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Response:**
```json
{
  "metadata": {
    "name": "cpu-ui-abc12"
  },
  "status": {
    "phase": "Failed",
    "message": "Stopped with strategy 'Terminate'"
  }
}
```

---

## Submit — CPU Stress

Runs stress-ng CPU workers at a configurable load percentage.

**Resource validation:** checks node CPU availability before spawning.
If validation fails, the stress pod never starts — the workflow fails at the validate step and callback fires with `error.type: bad_params`.

```bash
curl -k -X POST "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "metadata": { "generateName": "cpu-ui-" },
      "spec": {
        "workflowTemplateRef": { "name": "cpu-stress-api" },
        "arguments": { "parameters": [
          { "name": "target-node",  "value": "demo" },
          { "name": "workers",      "value": "2" },
          { "name": "load",         "value": "50" },
          { "name": "timeout",      "value": "1m" },
          { "name": "cpuset",       "value": "0-1" },
          { "name": "cpu_req",      "value": "1" },
          { "name": "cpu_lim",      "value": "2" },
          { "name": "callback-url", "value": "'${CALLBACK}'" }
        ]}
      }
    }
  }'
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target-node` | `demo` | Worker node hostname |
| `workers` | `1` | Number of stress-ng CPU workers |
| `load` | `50` | CPU load percentage per worker (1–100) |
| `timeout` | `1m` | Duration — accepts `30s`, `1m`, `2h` |
| `cpuset` | `0` | CPU cores to pin workers to (e.g. `0-3`, `0,2`) |
| `cpu_req` | `1` | CPU cores requested from k8s scheduler |
| `cpu_lim` | `1` | CPU cores limit for the pod |
| `callback-url` | `""` | HTTP endpoint to POST results to |

### Submit response

```json
{
  "metadata": {
    "name": "cpu-ui-abc12",
    "namespace": "stress"
  },
  "status": {
    "phase": "Pending"
  }
}
```

---

## Submit — Memory Stress

Allocates and continuously reads/writes memory at a configurable size and rate.

**Resource validation:** checks node memory availability before spawning.
If validation fails, the stress pod never starts.

```bash
curl -k -X POST "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "metadata": { "generateName": "mem-ui-" },
      "spec": {
        "workflowTemplateRef": { "name": "memory-stress-api" },
        "arguments": { "parameters": [
          { "name": "target-node",  "value": "demo" },
          { "name": "workers",      "value": "2" },
          { "name": "size",         "value": "0.5" },
          { "name": "timeout",      "value": "1m" },
          { "name": "read_mbps",    "value": "-1" },
          { "name": "write_mbps",   "value": "-1" },
          { "name": "cpuset",       "value": "0-1" },
          { "name": "cpu_req",      "value": "1" },
          { "name": "cpu_lim",      "value": "2" },
          { "name": "mem_req",      "value": "1Gi" },
          { "name": "mem_lim",      "value": "4Gi" },
          { "name": "callback-url", "value": "'${CALLBACK}'" }
        ]}
      }
    }
  }'
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target-node` | `demo` | Worker node hostname |
| `workers` | `1` | Number of memory stress workers |
| `size` | `0.25` | Memory per worker in GB (e.g. `0.5`, `2`) |
| `timeout` | `1m` | Duration |
| `read_mbps` | `-1` | Read throttle in MB/s — `-1` means unlimited |
| `write_mbps` | `-1` | Write throttle in MB/s — `-1` means unlimited |
| `cpuset` | `0` | CPU cores to pin workers to |
| `cpu_req` | `1` | CPU cores requested |
| `cpu_lim` | `1` | CPU cores limit |
| `mem_req` | `1Gi` | Memory requested from k8s scheduler |
| `mem_lim` | `7Gi` | Memory limit — must be ≥ `workers × size` GB |
| `callback-url` | `""` | HTTP endpoint to POST results to |

> **Note:** `mem_lim` is the pod's hard memory ceiling enforced by k8s. If `workers × size` exceeds `mem_lim`, the pod will be OOMKilled. The resource validator catches this before submission when there is insufficient node memory, but does not validate `mem_lim` vs `size` — that is the caller's responsibility.

---

## Submit — IO Stress

Runs fio-based disk IO stress with configurable access pattern and throughput targets.

**No resource validation** — IO uses a pre-provisioned file on the worker node.

```bash
curl -k -X POST "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "metadata": { "generateName": "io-ui-" },
      "spec": {
        "workflowTemplateRef": { "name": "io-stress-api" },
        "arguments": { "parameters": [
          { "name": "target-node",  "value": "demo" },
          { "name": "mode",         "value": "seq-read" },
          { "name": "runtime_sec",  "value": "30" },
          { "name": "target_mbps",  "value": "100" },
          { "name": "target_iops",  "value": "" },
          { "name": "block_size",   "value": "1M" },
          { "name": "iodepth",      "value": "1" },
          { "name": "cpu_req",      "value": "1" },
          { "name": "cpu_lim",      "value": "1" },
          { "name": "mem_req",      "value": "512Mi" },
          { "name": "mem_lim",      "value": "512Mi" },
          { "name": "callback-url", "value": "'${CALLBACK}'" }
        ]}
      }
    }
  }'
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target-node` | `demo` | Worker node hostname |
| `mode` | `seq-read` | IO pattern — `seq-read`, `seq-write`, `rand-read`, `rand-write` |
| `runtime_sec` | `30` | Duration in seconds |
| `target_mbps` | `100` | Target throughput in MB/s — leave empty to go unlimited |
| `target_iops` | `""` | Target IOPS — leave empty to use `target_mbps` instead |
| `block_size` | `1M` | IO block size (e.g. `4K`, `64K`, `1M`) |
| `iodepth` | `1` | Queue depth — higher values stress the IO scheduler more |
| `cpu_req` | `1` | CPU cores requested |
| `cpu_lim` | `1` | CPU cores limit |
| `mem_req` | `512Mi` | Memory requested |
| `mem_lim` | `512Mi` | Memory limit |
| `callback-url` | `""` | HTTP endpoint to POST results to |

---

## Submit — Network Stress

Runs iperf3 against a target iperf3 server with configurable bandwidth, protocol, and direction.

**No resource validation** — network resources are external to the cluster.

> **Prerequisite:** an iperf3 server must be running on the target host before submitting. Start one with: `iperf3 -s`

```bash
curl -k -X POST "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "workflow": {
      "metadata": { "generateName": "net-ui-" },
      "spec": {
        "workflowTemplateRef": { "name": "network-stress-api" },
        "arguments": { "parameters": [
          { "name": "target-node",  "value": "demo" },
          { "name": "server",       "value": "10.255.32.82" },
          { "name": "bandwidth",    "value": "100" },
          { "name": "proto",        "value": "tcp" },
          { "name": "direction",    "value": "upload" },
          { "name": "time",         "value": "20" },
          { "name": "cpu_req",      "value": "1" },
          { "name": "cpu_lim",      "value": "1" },
          { "name": "mem_req",      "value": "256Mi" },
          { "name": "mem_lim",      "value": "256Mi" },
          { "name": "callback-url", "value": "'${CALLBACK}'" }
        ]}
      }
    }
  }'
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `target-node` | `demo` | Worker node hostname |
| `server` | `10.255.32.82` | IP of the iperf3 server to connect to |
| `bandwidth` | `100` | Target bandwidth in Mbps |
| `proto` | `tcp` | Protocol — `tcp` or `udp` |
| `direction` | `upload` | `upload` (client→server) or `download` (server→client) |
| `time` | `20` | Duration in seconds |
| `cpu_req` | `1` | CPU cores requested |
| `cpu_lim` | `1` | CPU cores limit |
| `mem_req` | `256Mi` | Memory requested |
| `mem_lim` | `256Mi` | Memory limit |
| `callback-url` | `""` | HTTP endpoint to POST results to |

---

## Callback Payload

All modules POST to `callback-url` on completion — whether succeeded or failed.
The callback fires via the `onExit` handler, so it always runs even if the test crashes.

### Success payload

```json
{
  "workflow": "cpu-ui-abc12",
  "status": "Succeeded",
  "test_type": "cpu",
  "error": null,
  "parameters": {
    "target": "demo",
    "workers": "2",
    "load": "50",
    "timeout": "1m"
  },
  "started": "2026-05-14T10:00:00Z",
  "duration": "62.4"
}
```

### Failure payload

```json
{
  "workflow": "mem-ui-xyz99",
  "status": "Failed",
  "test_type": "memory",
  "error": {
    "type": "resource_exhaustion",
    "reason": "OOMKilled",
    "message": "Container killed — memory limit exceeded. Lower size or mem_lim."
  },
  "parameters": {
    "target": "demo",
    "size_gb": "4",
    "timeout": "1m",
    "workers": "2"
  },
  "started": "2026-05-14T10:05:00Z",
  "duration": "8.1"
}
```

### Important — resource validation behaviour

The CPU and memory modules run a validation step **before** the stress pod. However:

- Validation only checks **node available capacity vs requested** — it does not validate `mem_lim` vs `size`
- If the node has enough free memory but `mem_lim` is set lower than what the stress process needs, the pod spawns and then gets OOMKilled
- The caller is responsible for ensuring `mem_lim ≥ workers × size × 1.1` (10% headroom recommended)
- Validation failure produces `error.type: bad_params`, not `resource_exhaustion`

---

## Error Type Reference

| `error.type` | `error.reason` | When it fires | Action |
|---|---|---|---|
| `resource_exhaustion` | `OOMKilled` | Pod killed by kernel — memory limit hit during run | Lower `size`, `workers`, or raise `mem_lim` |
| `config_error` | `ImagePullBackOff` | Container image not found or registry unreachable | Check image name and network connectivity from worker node |
| `config_error` | `CreateContainerConfigError` | Missing volume, secret, or configmap | Check cluster config — hostPath volumes on IO module |
| `bad_params` | `ExitCode1` | Stress script exited with error — bad parameter values | Check parameter values — invalid `mode`, negative `size`, etc. |
| `stress_error` | `ExitCode<N>` | Container exited with unexpected non-zero code | Check pod logs for details |
| `workflow_error` | `NoPodFound` | Workflow failed before any pod was scheduled | Check cluster state — node may be unschedulable or tainted |

---

## Quick Reference

```bash
# set env vars once
export ARGO="https://10.255.32.82:32746"
export ARGO_TOKEN=$(kubectl get secret stress-ui-sa-token -n stress \
  -o jsonpath='{.data.token}' | base64 -d)
export CALLBACK="http://<ui-vm-ip>:3000/api/callback"

# list all workflows
curl -sk "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" | python3 -m json.tool

# poll a specific workflow
curl -sk "${ARGO}/api/v1/workflows/stress/<name>" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  | python3 -m json.tool | grep '"phase"'

# terminate a workflow
curl -sk -X PUT "${ARGO}/api/v1/workflows/stress/<name>/terminate" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" -d '{}'

# get workflow name from submit response
curl -sk -X POST "${ARGO}/api/v1/workflows/stress" \
  -H "Authorization: Bearer ${ARGO_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{...}' | python3 -c "import sys,json; print(json.load(sys.stdin)['metadata']['name'])"
```
