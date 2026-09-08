#!/usr/bin/env python3
"""Compare tools/qr-check.mjs output against the `qrcode` package.

    python3 -m venv /tmp/qrv && /tmp/qrv/bin/pip install qrcode
    node tools/qr-check.mjs > /tmp/qr.json
    /tmp/qrv/bin/python tools/qr-check.py /tmp/qr.json

Exits non-zero if any symbol differs by a single module. Nothing in squrl
depends on this at runtime or in its tests -- test/qr.mjs carries fixtures that
were verified here, so the check is reproducible without the dependency.
"""

import json
import sys

import qrcode
from qrcode.constants import (
    ERROR_CORRECT_L, ERROR_CORRECT_M, ERROR_CORRECT_Q, ERROR_CORRECT_H,
)

LEVELS = {
    "L": ERROR_CORRECT_L, "M": ERROR_CORRECT_M,
    "Q": ERROR_CORRECT_Q, "H": ERROR_CORRECT_H,
}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/qr.json"
    cases = json.load(open(path))

    matched = 0
    failures = []

    for case in cases:
        qr = qrcode.QRCode(
            version=case["version"],
            error_correction=LEVELS[case["level"]],
            border=0,
            mask_pattern=case["mask"],
        )
        qr.add_data(case["text"])
        qr.make(fit=False)

        reference = ["".join("1" if cell else "0" for cell in row)
                     for row in qr.get_matrix()]

        if reference == case["matrix"]:
            matched += 1
        else:
            differing = sum(
                1 for a, b in zip("".join(reference), "".join(case["matrix"])) if a != b
            )
            failures.append((case["version"], case["level"], case["mask"], differing))

    print(f"matched {matched} of {len(cases)}")
    for version, level, mask, differing in failures[:20]:
        print(f"  version {version}{level} mask {mask}: {differing} modules differ")

    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
