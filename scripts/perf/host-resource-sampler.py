#!/usr/bin/env python3

import argparse
import csv
import json
import os
import platform
import re
import time
from datetime import datetime, timezone
from pathlib import Path


WHOLE_DISK = re.compile(r"^(?:nvme\d+n\d+|xvd[a-z]+|sd[a-z]+|vd[a-z]+)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sample Linux host resources at a fixed interval.")
    parser.add_argument("--role", required=True, choices=("loadgen", "gateway", "data", "mock"))
    parser.add_argument("--duration-seconds", required=True, type=int)
    parser.add_argument("--interval-seconds", type=float, default=1.0)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()
    if args.duration_seconds <= 0:
        parser.error("--duration-seconds must be positive")
    if args.interval_seconds <= 0:
        parser.error("--interval-seconds must be positive")
    return args


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def read_cpu() -> dict[str, int]:
    with open("/proc/stat", encoding="ascii") as handle:
        fields = handle.readline().split()
    values = [int(value) for value in fields[1:11]]
    return {
        "total": sum(values),
        "idle": values[3],
        "iowait": values[4],
        "steal": values[7],
    }


def read_memory() -> dict[str, int]:
    values: dict[str, int] = {}
    with open("/proc/meminfo", encoding="ascii") as handle:
        for line in handle:
            key, raw = line.split(":", 1)
            values[key] = int(raw.strip().split()[0]) * 1024
    total = values["MemTotal"]
    available = values.get("MemAvailable", values.get("MemFree", 0))
    return {"total": total, "available": available, "used": max(total - available, 0)}


def read_disk_sectors() -> tuple[int, int]:
    read_sectors = 0
    write_sectors = 0
    with open("/proc/diskstats", encoding="ascii") as handle:
        for line in handle:
            fields = line.split()
            if len(fields) < 14 or not WHOLE_DISK.match(fields[2]):
                continue
            read_sectors += int(fields[5])
            write_sectors += int(fields[9])
    return read_sectors, write_sectors


def read_network_bytes() -> tuple[int, int]:
    received = 0
    transmitted = 0
    with open("/proc/net/dev", encoding="ascii") as handle:
        for line in handle:
            if ":" not in line:
                continue
            interface, raw = line.split(":", 1)
            if interface.strip() == "lo":
                continue
            fields = raw.split()
            received += int(fields[0])
            transmitted += int(fields[8])
    return received, transmitted


def delta_rate(current: int, previous: int, elapsed: float) -> float:
    return max(current - previous, 0) / elapsed if elapsed > 0 else 0.0


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    csv_path = output_dir / f"{args.role}.host-resources.csv"
    summary_path = output_dir / f"{args.role}.host-resources.summary.json"

    cpu_previous = read_cpu()
    disk_previous = read_disk_sectors()
    network_previous = read_network_bytes()
    previous_time = time.monotonic()
    deadline = previous_time + args.duration_seconds
    next_tick = previous_time + args.interval_seconds
    rows: list[dict[str, float | int | str]] = []

    while next_tick <= deadline + 1e-9:
        time.sleep(max(next_tick - time.monotonic(), 0))
        observed_time = time.monotonic()
        elapsed = max(observed_time - previous_time, 1e-9)
        cpu_current = read_cpu()
        disk_current = read_disk_sectors()
        network_current = read_network_bytes()
        memory = read_memory()

        total_delta = max(cpu_current["total"] - cpu_previous["total"], 1)
        idle_delta = max(cpu_current["idle"] - cpu_previous["idle"], 0)
        iowait_delta = max(cpu_current["iowait"] - cpu_previous["iowait"], 0)
        steal_delta = max(cpu_current["steal"] - cpu_previous["steal"], 0)
        busy_delta = max(total_delta - idle_delta - iowait_delta, 0)

        row = {
            "timestampUtc": utc_now(),
            "intervalSeconds": round(elapsed, 6),
            "cpuBusyPercent": round(100.0 * busy_delta / total_delta, 3),
            "cpuIowaitPercent": round(100.0 * iowait_delta / total_delta, 3),
            "cpuStealPercent": round(100.0 * steal_delta / total_delta, 3),
            "memoryUsedBytes": memory["used"],
            "memoryAvailableBytes": memory["available"],
            "diskReadBytesPerSecond": round(delta_rate(disk_current[0], disk_previous[0], elapsed) * 512, 3),
            "diskWriteBytesPerSecond": round(delta_rate(disk_current[1], disk_previous[1], elapsed) * 512, 3),
            "networkReceiveBytesPerSecond": round(delta_rate(network_current[0], network_previous[0], elapsed), 3),
            "networkTransmitBytesPerSecond": round(delta_rate(network_current[1], network_previous[1], elapsed), 3),
        }
        rows.append(row)
        cpu_previous = cpu_current
        disk_previous = disk_current
        network_previous = network_current
        previous_time = observed_time
        next_tick += args.interval_seconds

    fieldnames = list(rows[0].keys()) if rows else []
    with open(csv_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    def maximum(name: str) -> float:
        return max((float(row[name]) for row in rows), default=0.0)

    summary = {
        "schemaVersion": "gatelm.perf.host-resources.v1",
        "role": args.role,
        "sampleIntervalSeconds": args.interval_seconds,
        "sampleCount": len(rows),
        "cpuCount": os.cpu_count(),
        "memoryTotalBytes": read_memory()["total"],
        "kernel": platform.release(),
        "maxima": {
            "cpuBusyPercent": maximum("cpuBusyPercent"),
            "cpuIowaitPercent": maximum("cpuIowaitPercent"),
            "cpuStealPercent": maximum("cpuStealPercent"),
            "memoryUsedBytes": maximum("memoryUsedBytes"),
            "diskReadBytesPerSecond": maximum("diskReadBytesPerSecond"),
            "diskWriteBytesPerSecond": maximum("diskWriteBytesPerSecond"),
            "networkReceiveBytesPerSecond": maximum("networkReceiveBytesPerSecond"),
            "networkTransmitBytesPerSecond": maximum("networkTransmitBytesPerSecond"),
        },
    }
    with open(summary_path, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2, sort_keys=True)
        handle.write("\n")

    print(f"Host resource evidence: {output_dir}")


if __name__ == "__main__":
    main()
