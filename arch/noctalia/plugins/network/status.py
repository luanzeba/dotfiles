#!/usr/bin/env python3
"""Emit NetworkManager's Wi-Fi state as one stable JSON document."""

import json
import re
import subprocess
import sys


def nmcli(*args):
    try:
        return subprocess.run(
            ["/usr/bin/nmcli", *args],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=8,
        ).stdout
    except (OSError, subprocess.TimeoutExpired):
        return ""


def fields(line):
    """Split nmcli's --terse --escape yes records without losing escaped colons."""
    values, current, escaped = [], [], False
    for character in line:
        if escaped:
            current.append(character)
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            values.append("".join(current))
            current = []
        else:
            current.append(character)
    if escaped:
        current.append("\\")
    values.append("".join(current))
    return values


def first_line(command):
    return next((line.strip() for line in command.splitlines() if line.strip()), "")


def read_counter(interface, name):
    try:
        with open(f"/sys/class/net/{interface}/statistics/{name}", encoding="utf-8") as counter:
            return int(counter.read().strip())
    except (OSError, ValueError):
        return 0


def band_for_frequency(value):
    try:
        mhz = int(re.search(r"\d+", value).group())
    except (AttributeError, ValueError):
        return ""
    if 2400 <= mhz < 2500:
        return "2.4 GHz"
    if 4900 <= mhz < 5900:
        return "5 GHz"
    if 5925 <= mhz < 7200:
        return "6 GHz"
    return ""


def ping_ms():
    try:
        output = subprocess.run(
            ["/usr/bin/ping", "-n", "-c", "1", "-W", "1", "1.1.1.1"],
            check=False,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
        ).stdout
        match = re.search(r"time=([0-9.]+)\s*ms", output)
        return float(match.group(1)) if match else None
    except (OSError, subprocess.TimeoutExpired, ValueError):
        return None


def main():
    wifi_enabled = first_line(nmcli("-t", "-f", "WIFI", "general")) == "enabled"
    devices = [fields(line) for line in nmcli("-t", "--escape", "yes", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device", "status").splitlines()]
    wifi_devices = [row for row in devices if len(row) >= 4 and row[1] == "wifi"]
    active = next((row for row in wifi_devices if row[2] == "connected"), wifi_devices[0] if wifi_devices else ["", "", "", ""])
    interface, state, connection = active[0], active[2], active[3]

    details = nmcli("-t", "--escape", "yes", "-f", "IP4.ADDRESS,IP4.GATEWAY", "device", "show", interface) if interface else ""
    ip_address = ""
    gateway = ""
    for line in details.splitlines():
        key, *value = fields(line)
        if not value:
            continue
        if key.startswith("IP4.ADDRESS") and not ip_address:
            ip_address = value[0].split("/", 1)[0]
        elif key == "IP4.GATEWAY":
            gateway = value[0]

    known = {
        row[0]
        for row in (fields(line) for line in nmcli("-t", "--escape", "yes", "-f", "NAME,TYPE", "connection", "show").splitlines())
        if len(row) >= 2 and row[1] == "802-11-wireless"
    }

    networks = {}
    band = ""
    rescan = "auto" if "--scan" in sys.argv else "no"
    scan = nmcli("-t", "--escape", "yes", "-f", "IN-USE,SSID,SIGNAL,SECURITY,FREQ", "device", "wifi", "list", "--rescan", rescan) if interface else ""
    for row in (fields(line) for line in scan.splitlines()):
        if len(row) < 5 or not row[1]:
            continue
        try:
            signal = int(row[2])
        except ValueError:
            signal = 0
        ssid = row[1]
        existing = networks.get(ssid, {"ssid": ssid, "signal": 0, "security": row[3], "connected": False, "known": ssid in known})
        existing["signal"] = max(existing["signal"], signal)
        existing["connected"] = existing["connected"] or row[0] == "*"
        if row[0] == "*":
            band = band_for_frequency(row[4])
        existing["known"] = existing["known"] or ssid in known
        if not existing["security"]:
            existing["security"] = row[3]
        networks[ssid] = existing

    rows = sorted(networks.values(), key=lambda row: (not row["connected"], not row["known"], -row["signal"], row["ssid"].casefold()))
    print(json.dumps({
        "wifi_enabled": wifi_enabled,
        "interface": interface,
        "state": state,
        "ssid": connection,
        "ip": ip_address,
        "gateway": gateway,
        "band": band,
        "downloaded": read_counter(interface, "rx_bytes") if interface else 0,
        "uploaded": read_counter(interface, "tx_bytes") if interface else 0,
        "ping_ms": ping_ms() if state == "connected" else None,
        "networks": rows,
    }, ensure_ascii=False))


def self_test():
    assert fields(r"*:Vieiras:85:WPA2:5200 MHz") == ["*", "Vieiras", "85", "WPA2", "5200 MHz"]
    assert band_for_frequency("2437 MHz") == "2.4 GHz"
    assert band_for_frequency("5200 MHz") == "5 GHz"
    assert band_for_frequency("6115 MHz") == "6 GHz"


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
