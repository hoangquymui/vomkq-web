#!/usr/bin/env python3
"""Installer. Run: python setup.py --project 'E:\\your\\project'"""
import argparse
import json
import pathlib
import shutil
import subprocess
import sys
import time

BASE = pathlib.Path(__file__).resolve().parent

def load(path):
    try: return json.loads(path.read_text(encoding='utf-8-sig'))
    except FileNotFoundError: return {}


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='Install Codex technical lead in an Antigravity workspace.')
    parser.add_argument('--project', required=True, help='Absolute path to EXISTING Git project')
    a = parser.parse_args()
    root = pathlib.Path(a.project).expanduser().resolve()
    if not root.is_dir(): raise SystemExit(f'Project folder does not exist: {root}')
    check = subprocess.run(['git', 'rev-parse', '--show-toplevel'], cwd=root,
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
    if check.returncode: raise SystemExit('Project must be a Git repository. Run git init first (after backing up).')
    if pathlib.Path(check.stdout.strip()).resolve() != root:
        raise SystemExit('Supply the Git repository ROOT, not a subfolder: ' + check.stdout.strip())
    sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    target = root / '.agents'
    target.mkdir(exist_ok=True)
    for src, dst in [('supervisor.py', 'codex_supervisor.py'),
                     ('codex_review.schema.json', 'codex_review.schema.json')]:
        dest = target / dst
        if dest.exists():
            backup = dest.with_suffix(dest.suffix + '.backup-' + str(int(time.time())))
            shutil.copy2(dest, backup)
        shutil.copy2(BASE / src, dest)
    task = root / 'SUPERVISOR_TASK.md'
    if not task.exists(): shutil.copy2(BASE / 'TASK_TEMPLATE.md', task)
    hooks = target / 'hooks.json'
    data = load(hooks)
    if not isinstance(data, dict): raise SystemExit('hooks.json not an object; fix manually first.')
    if hooks.exists(): shutil.copy2(hooks, target / ('hooks.json.backup-' + str(int(time.time()))))
    # Absolute, quoted executable and script. No escaping needed except via JSON serializer.
    prefix = '"' + sys.executable + '" "' + str(target / 'codex_supervisor.py') + '"'
    data['codex-tech-lead'] = {
        'enabled': True,
        'Stop': [{'type': 'command', 'command': prefix + ' --hook', 'timeout': 240}],
        'PostToolUse': [{'matcher': 'write_to_file|replace_file_content|multi_replace_file_content',
                         'hooks': [{'type': 'command', 'command': prefix + ' --audit', 'timeout': 10}]}]
    }
    save(hooks, data)
    hidden = root / '.codex-supervisor'
    hidden.mkdir(exist_ok=True)
    settings = hidden / 'settings.json'
    cfg = load(settings)
    cfg.setdefault('baseline_sha', sha)
    cfg.setdefault('max_auto_repairs', 2)
    cfg.setdefault('review_timeout_seconds', 150)
    cfg.setdefault('max_changed_files', 250)
    save(settings, cfg)
    ignore = root / '.gitignore'
    marker = '.codex-supervisor/'
    current = ignore.read_text(encoding='utf-8-sig') if ignore.exists() else ''
    if marker not in current.splitlines():
        with ignore.open('a', encoding='utf-8') as f:
            if current and not current.endswith('\n'): f.write('\n')
            f.write('\n# Codex technical lead private logs\n' + marker + '\n')
    print('Installed successfully in:', root)
    print('  Stop + PostToolUse hook:', hooks)
    print('  Fill requirements in:', task)
    print('  Test: python "' + str(target / 'codex_supervisor.py') + '" --doctor')
    print('  Restart Antigravity IDE and enable/trust workspace hooks in Customizations > Hooks.')
    print('  IMPORTANT: Codex review sends relevant repository data to the chosen model provider.')

if __name__ == '__main__': main()
