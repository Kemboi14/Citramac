"""Print `kubectl run --overrides` JSON for a one-off backend pod (migrations).

Usage: kubectl get deploy citramac-backend -o json |
           python3 pod_overrides.py <image> <check|migrate>

The pod copies the live backend Deployment's container config (envFrom, env,
securityContext) so it sees the same settings and secrets, and:

- is labelled app=citramac-celery-worker, never app=citramac-backend. The DB
  NetworkPolicy admits both, but the backend Services (and the backend HPA)
  select app=citramac-backend, so a bare pod with that label would be sent
  live requests it can't serve while it runs.
- in "migrate" mode, takes DATABASE_URL from MIGRATION_DATABASE_URL in the
  backend secret, so the schema is changed by the migration role and the
  URL never passes through a shell or a log.
"""

import json
import sys

COMMANDS = {
    # Exits non-zero when the image has migrations the database hasn't applied.
    "check": ["python", "manage.py", "migrate", "--check", "--noinput"],
    "migrate": ["python", "manage.py", "migrate", "--noinput"],
}


def main(image, mode):
    deployment = json.load(sys.stdin)
    pod_spec = deployment["spec"]["template"]["spec"]
    source = pod_spec["containers"][0]
    env = [e for e in source.get("env", []) if e["name"] != "DATABASE_URL"]
    if mode == "migrate":
        secret = next(
            ref["secretRef"]["name"]
            for ref in source.get("envFrom", [])
            if "secretRef" in ref
        )
        env.append(
            {
                "name": "DATABASE_URL",
                "valueFrom": {
                    "secretKeyRef": {"name": secret, "key": "MIGRATION_DATABASE_URL"}
                },
            }
        )
    container = {
        "name": "autodeploy",
        "image": image,
        "imagePullPolicy": "Never",
        "command": COMMANDS[mode],
        "envFrom": source.get("envFrom", []),
        "env": env,
    }
    if "securityContext" in source:
        container["securityContext"] = source["securityContext"]
    spec = {"restartPolicy": "Never", "containers": [container]}
    if "securityContext" in pod_spec:
        spec["securityContext"] = pod_spec["securityContext"]
    overrides = {
        "metadata": {
            "labels": {
                "app": "citramac-celery-worker",
                "project": "citramac",
                "citramac-autodeploy": mode,
            }
        },
        "spec": spec,
    }
    print(json.dumps(overrides))


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in COMMANDS:
        sys.exit("usage: pod_overrides.py <image> <check|migrate>")
    main(sys.argv[1], sys.argv[2])
