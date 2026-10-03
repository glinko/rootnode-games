"""Public GitHub checks gate for the daily publisher; no credentials required."""
import argparse
import json
import re
import urllib.request


def require_success(commit):
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid commit')
    request = urllib.request.Request(
        f'https://api.github.com/repos/glinko/rootnode-games/commits/{commit}/check-runs?filter=latest&per_page=100',
        headers={'Accept': 'application/vnd.github+json', 'User-Agent': 'rootnode-games-sync'})
    with urllib.request.urlopen(request, timeout=20) as response:
        checks = json.load(response).get('check_runs', [])
    valid = [check for check in checks if check.get('name') == 'catalogue-validation' and check.get('head_sha') == commit and check.get('app', {}).get('slug') == 'github-actions']
    if not valid or not all(check.get('status') == 'completed' and check.get('conclusion') == 'success' for check in valid):
        raise RuntimeError('The main commit has no successful catalogue-validation check; keeping current release')
    print(f'GitHub CI passed for {commit}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('commit')
    require_success(parser.parse_args().commit)
