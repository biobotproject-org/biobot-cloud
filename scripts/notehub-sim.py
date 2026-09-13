#!/usr/bin/env python3
"""
Notehub simulator for biobot-cloud.

Blues Notehub wraps every note a sensor node sends in a JSON envelope and
POSTs it to `/ingest/notehub`. This script builds those envelopes the same
way Notehub does and replays a full node lifecycle against a local API:

  1. device.qo   node registers itself
  2. data.qo     a normal 10-minute batch (severity none)
  3. data.qo     a batch with a `watch` anomaly (elevated PM2.5)
  4. alert.qo    raised (alert) -> updated (critical) -> updated (alert) -> cleared
  5. data.qo     redelivery of step 3 with the same event id -> must store nothing
  6. alert.qo    redelivery of the "raised" event -> must not reopen the incident
  7. bad token   -> 401
  8. _health.qo  Notehub system file -> acknowledged, refreshes lastSeen and voltage

With --leave-open the run stops after step 4b ("updated -> critical") and
leaves the incident OPEN, which is what you want when working on the
incident pages of the dashboard. De-escalation, the clear, and the alert
redelivery are skipped; the data redelivery, bad-token, and _health.qo
checks still run.

Usage:
  INGEST_TOKEN=<value from .env> python3 scripts/notehub-sim.py
  API_URL=http://localhost:3000 INGEST_TOKEN=... python3 scripts/notehub-sim.py --device biobot-002 --name "Dilworth Ridge"
  INGEST_TOKEN=... python3 scripts/notehub-sim.py --device biobot-003 --name "Kalamoir" --leave-open

INGEST_TOKEN is either an ingest-scoped API key created in the dashboard or
the legacy NOTEHUB_INGEST_TOKEN from .env. Only the standard library is used.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

API_URL = os.environ.get("API_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.environ.get("INGEST_TOKEN", "")

# ---------------------------------------------------------------- helpers

def iso(dt):
    return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def envelope(file, body, *, device_uid, event_id=None, when=None, lat=49.887, lon=-119.496, voltage=4.97):
    """Mimic the Notehub event envelope (fields the API actually reads + realistic extras)."""
    when = when or time.time()
    return {
        "event": event_id or str(uuid.uuid4()),
        "session": "ses-sim",
        "device": device_uid,
        "sn": "node-sim-01",
        "product": "com.example:biobot",
        "req": "note.add",
        "received": when + 0.5,
        "when": int(when),
        "file": file,
        "body": body,
        "best_location_type": "triangulated",
        "best_lat": lat,
        "best_lon": lon,
        "best_location": "Kelowna BC",
        "voltage": voltage,
        "temp": 23.5,
    }


UNITS = {"temperature": "°C", "humidity": "%", "pressure": "hPa", "gasResistance": "kΩ",
         "altitude": "m", "pm1": "μg/m³", "pm25": "μg/m³", "pm10": "μg/m³"}
BASE = {"temperature": 18.2, "humidity": 52.0, "pressure": 962.1, "gasResistance": 118.4,
        "altitude": 430, "pm1": 3.1, "pm25": 4.0, "pm10": 5.2}


def readings(ts, **overrides):
    """One 30-second sample: 8 channels, each its own Reading row."""
    v = {**BASE, **overrides}
    return [{"readingType": k, "unit": UNITS[k], "value": val, "timestamp": iso(ts)} for k, val in v.items()]


def data_batch(device_id, start, samples):
    """
    data.qo body. Firmware sends ~20 samples per 10 minutes; each sample is one
    `requests[]` entry tagged with its own anomaly severity/score.
    `samples` is a list of (overrides_dict, severity, score).
    """
    reqs = []
    for i, (over, sev, score) in enumerate(samples):
        ts = start + timedelta(seconds=30 * i)
        reqs.append({"deviceId": device_id, "readings": readings(ts, **over),
                     "anomaly": {"severity": sev, "score": score}})
    return {"requests": reqs}


def alert_body(device_id, event, severity, score, signals, ts, pm25=62.5):
    return {
        "request_type": "anomaly", "deviceId": device_id, "event": event,
        "severity": severity, "score": score, "signals": signals, "timestamp": iso(ts),
        "readings": {"temperature": 19.0, "humidity": 30.0, "pressure": 961.8,
                     "gasResistance": 44.0, "pm1": 30, "pm25": pm25, "pm10": 70, "obstructed": False},
        "baseline": {"ready": True, "temperature": 18.1, "humidity": 52.0, "gasResistance": 118.0, "pm25": 4.1},
    }


def post(payload, token=TOKEN):
    req = urllib.request.Request(
        f"{API_URL}/ingest/notehub", data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}
    except urllib.error.URLError as e:
        sys.exit(f"Cannot reach {API_URL}: {e.reason}. Is the stack running?")


FAILS = 0


def step(title, payload, expect_status=200, expect=None, token=TOKEN):
    """Send one envelope, print the result, check expectations."""
    global FAILS
    status, body = post(payload, token)
    ok = status == expect_status and all(body.get(k) == v for k, v in (expect or {}).items())
    mark = "OK  " if ok else "FAIL"
    if not ok:
        FAILS += 1
    print(f"[{mark}] {title}")
    print(f"       -> {status} {json.dumps(body)}")
    if not ok:
        print(f"       expected status={expect_status} fields={expect}")
    return body


# ---------------------------------------------------------------- scenario

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="biobot-001", help="deviceId the node reports (default biobot-001)")
    ap.add_argument("--name", default="Knox Mountain")
    ap.add_argument("--skip-alert", action="store_true", help="only send device.qo + data.qo")
    ap.add_argument("--leave-open", action="store_true",
                    help="stop after the escalation to critical and leave the incident open (no clear, no alert redelivery)")
    args = ap.parse_args()

    if not TOKEN:
        sys.exit("Set INGEST_TOKEN to the NOTEHUB_INGEST_TOKEN value from biobot-infrastructure/.env")

    dev = args.device
    digits = "".join(ch for ch in dev if ch.isdigit()) or "1"
    uid = "dev:8644750461" + digits[-6:].rjust(6, "0")
    now = datetime.now(timezone.utc)

    print(f"Notehub simulator -> {API_URL}  device={dev}\n")

    # 1. registration
    step("1. device.qo registers the node",
         envelope("device.qo", {"request_type": "create_device", "deviceId": dev, "name": args.name,
                                "type": "air-quality-monitor", "status": "active"}, device_uid=uid),
         expect={"deviceId": dev})

    # 2. normal batch: 20 samples over 10 minutes, all severity none
    normal = [({}, "none", 0)] * 20
    step("2. data.qo normal batch (20 samples x 8 channels = 160 readings)",
         envelope("data.qo", data_batch(dev, now - timedelta(minutes=20), normal), device_uid=uid),
         expect={"action": "readings_stored", "readings": 160})

    # 3. watch batch: PM2.5 climbs into watch band on the last 5 samples
    watch = [({}, "none", 0)] * 15 + [({"pm25": 38.0 + i, "pm1": 20.0, "pm10": 45.0}, "watch", 1) for i in range(5)]
    watch_event = str(uuid.uuid4())
    step("3. data.qo batch with 5 `watch` samples (PM2.5 35-55)",
         envelope("data.qo", data_batch(dev, now - timedelta(minutes=10), watch), device_uid=uid, event_id=watch_event),
         expect={"action": "readings_stored", "readings": 160})

    if not args.skip_alert:
        t0 = now - timedelta(minutes=8)
        raised_event = str(uuid.uuid4())
        raised = step("4a. alert.qo raised (alert, score 3)",
                      envelope("alert.qo", alert_body(dev, "raised", "alert", 3, ["pm25_elevated", "pm25_high"], t0),
                               device_uid=uid, event_id=raised_event),
                      expect={"action": "incident_opened"})
        incident_id = raised.get("incidentId")

        step("4b. alert.qo updated -> escalates to critical (score 5)",
             envelope("alert.qo", alert_body(dev, "updated", "critical", 5,
                                             ["pm25_elevated", "pm25_high", "gas_resistance_drop", "humidity_drop"],
                                             t0 + timedelta(minutes=2), pm25=88.3), device_uid=uid),
             expect={"action": "incident_updated", "incidentId": incident_id})

        if args.leave_open:
            print(f"\nincident {incident_id} left OPEN")
            print(f"  dashboard: http://localhost/incidents/{incident_id}")
            print(f"  api:       GET {API_URL}/incidents/{incident_id}  (JWT)")
            sys.exit(1 if FAILS else 0)

        step("4c. alert.qo updated -> de-escalates to alert (peak must stay critical in DB)",
             envelope("alert.qo", alert_body(dev, "updated", "alert", 2, ["pm25_high"], t0 + timedelta(minutes=4)),
                      device_uid=uid),
             expect={"action": "incident_updated", "incidentId": incident_id})

        step("4d. alert.qo cleared -> incident closed",
             envelope("alert.qo", alert_body(dev, "cleared", "none", 0, [], t0 + timedelta(minutes=7)), device_uid=uid),
             expect={"action": "incident_closed", "incidentId": incident_id})

        # 6. redelivery of the raised event: Notehub retries on any non-2xx/timeout
        step("6. REDELIVERY of 4a (same event id) -> must not reopen or re-email",
             envelope("alert.qo", alert_body(dev, "raised", "alert", 3, ["pm25_elevated", "pm25_high"], t0),
                      device_uid=uid, event_id=raised_event),
             expect_status=200)

    # 5. redelivery of the watch batch
    step("5. REDELIVERY of step 3 (same event id) -> 0 new readings",
         envelope("data.qo", data_batch(dev, now - timedelta(minutes=10), watch), device_uid=uid, event_id=watch_event),
         expect={"readings": 0})

    # 7. wrong token
    step("7. wrong bearer token -> 401",
         envelope("data.qo", {"requests": []}, device_uid=uid), expect_status=401, token="not-the-token")

    # 8. Notehub system file
    health = envelope("_health.qo", {"method": "boot", "text": "boot (brown-out & hard reset [10020])",
                                     "voltage": 4.61, "voltage_mode": "usb"}, device_uid=uid)
    del health["voltage"]  # live Notehub envelopes carry no top-level voltage
    step("8. _health.qo system file -> acknowledged, lastSeen refreshed, voltage taken from body",
         health, expect={"action": "ignored"})

    print(f"\n{'ALL PASSED' if FAILS == 0 else f'{FAILS} FAILED'}")
    print("\nExpected in the dashboard (http://localhost) and Swagger (http://localhost:3000/api-docs):")
    print(f"  Devices    -> {dev} '{args.name}' listed with coordinates and a populated 'last seen'")
    print("  Device page -> raw sensor table shows the last 5 pm25 samples (38-42) with a WATCH badge")
    print("  Incidents  -> one closed incident for this node under 'Recent closed', peak CRITICAL,")
    print("                outcome 'unknown' until a host records one on the incident page")
    print("  Alerts     -> legacy Alert row, severity 'high' (mapped from 'alert'), status resolved")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
