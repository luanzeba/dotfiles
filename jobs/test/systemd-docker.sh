#!/bin/bash
# Exercise jobs with real systemd user timers in a throwaway Docker container (Fedora arm64/amd64; same
# user-timer semantics as Arch). Run from anywhere: jobs/test/systemd-docker.sh
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
image=jobs-test-systemd
container="jobs-test-systemd-$$"

docker build -q -t "$image" - >/dev/null <<'EOF'
FROM fedora:latest
RUN dnf install -y systemd nodejs procps-ng && dnf clean all
RUN useradd -m tester && mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/tester
STOPSIGNAL SIGRTMIN+3
CMD ["/usr/sbin/init"]
EOF
trap 'docker rm -f "$container" >/dev/null 2>&1' EXIT
docker run -d --name "$container" --privileged --cgroupns=private --tmpfs /run --tmpfs /tmp "$image" >/dev/null
for _ in $(seq 30); do docker exec "$container" systemctl is-active -q user@1000.service 2>/dev/null && break; sleep 1; done

docker exec "$container" mkdir -p /home/tester/dotfiles
docker cp "$repo/lib" "$container:/home/tester/dotfiles/lib"
docker cp "$repo/jobs" "$container:/home/tester/dotfiles/jobs"
docker exec -i "$container" tee /home/tester/dotfiles/jobs/jobs.json >/dev/null <<'EOF'
{
  "jobs-check": { "schedule": "15,45 * * * *", "command": "\"$DOTFILES_DIR/jobs/jobs\" check", "timeout": "2m" },
  "test": { "schedule": "0 * * * *", "command": "echo hello from $JOB_NAME; [ ! -e /tmp/fail ]", "timeout": "1m" },
  "test-slow": { "schedule": "30 9 * * 1-5", "command": "sleep 300 & echo $! > /tmp/sleep.pid; wait", "timeout": "3s" }
}
EOF
docker exec "$container" chown -R tester:tester /home/tester/dotfiles

t() { docker exec -u tester -e XDG_RUNTIME_DIR=/run/user/1000 -w /home/tester "$container" bash -lc "$1"; }
expect() { # expect <description> <command> <regex over the whole output>
    local out
    out="$(t "$2" 2>&1)" || true
    [[ "$out" =~ $3 ]] || { printf 'FAIL: %s\n%s\n' "$1" "$out" >&2; exit 1; }
    echo "ok: $1"
}
jobs=/home/tester/dotfiles/jobs/jobs

expect 'enable starts timers, with jobs-check' "$jobs enable test test-slow >/dev/null && systemctl --user is-active jobs-test.timer jobs-test-slow.timer jobs-jobs-check.timer" '^active.active.active$'
expect 'OnCalendar is what systemd understands' 'systemd-analyze calendar "$(sed -n "s/^OnCalendar=//p" ~/.config/systemd/user/jobs-test-slow.timer)"' 'Normalized form: Mon\.\.Fri \*-\*-\* 09:30:00'
expect 'run goes through systemd' "$jobs run test; journalctl --user -u jobs-test.service" 'hello from test.*Finished jobs-test\.service'
expect 'status shows the run' "$jobs" 'test +0 \* \* \* \* .* ok +0s'
expect 'Persistent catches up a run missed while off' \
    'systemctl --user stop jobs-test.timer; touch -d "-2 hours" ~/.local/share/systemd/timers/stamp-jobs-test.timer; systemctl --user start jobs-test.timer; sleep 3; journalctl --user -u jobs-test.service | grep -c Finished' '^2$'
expect 'two failures are failing' "touch /tmp/fail; $jobs run test; $jobs run test; $jobs" 'failing: last 2 runs failed'
expect 'a stopped timer is not loaded' "systemctl --user stop jobs-test.timer; $jobs" 'not loaded'
expect 'sync reloads it' "$jobs sync && $jobs" 'test +0 \* \* \* \* .*exit 1.*failing'
expect 'timeout kills the process group' "$jobs run test-slow; sleep 1; ps -p \$(cat /tmp/sleep.pid) >/dev/null && echo alive || echo killed" 'timeout after [0-9]+s.*killed$'
edit() { t "node -e 'const f=process.argv[1], j=JSON.parse(require(\"fs\").readFileSync(f)); $1; require(\"fs\").writeFileSync(f, JSON.stringify(j))' ~/dotfiles/jobs/jobs.json"; }
edit 'j["test-slow"].schedule = "45 9 * * 1-5"'
expect 'a changed schedule is out of date' "$jobs" 'test-slow .* out of date with jobs\.json'
expect 'sync applies it' "$jobs sync && cat ~/.config/systemd/user/jobs-test-slow.timer" 'reloaded test-slow.*OnCalendar=Mon,Tue,Wed,Thu,Fri \*-\*-\* 09:45:00'
edit 'delete j.test'
expect 'a removed job is reported' "$jobs" 'test +\? .*not in jobs\.json'
expect 'sync removes its units' "$jobs sync && ls ~/.config/systemd/user" 'removed test \(no longer in jobs\.json\)'
expect 'disable removes the units' "$jobs disable test-slow >/dev/null; ls ~/.config/systemd/user | grep -c '^jobs-test'" '^0$'
echo 'systemd checks passed'
