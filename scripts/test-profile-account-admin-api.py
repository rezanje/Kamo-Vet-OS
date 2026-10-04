#!/usr/bin/env python3
"""Fictional local GoTrue/PostgREST profile checks; never prints keys or JWTs."""
import argparse
import base64
import json
from pathlib import Path
import secrets
import urllib.error
import urllib.request
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--manifest', required=True, type=Path,
                    help='Authorized generated LOCAL auth manifest with API_URL/ANON_KEY/SERVICE_ROLE_KEY')
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text())
api_url = manifest['API_URL'].rstrip('/')
if api_url != 'http://127.0.0.1:55421':
    raise SystemExit('This fictional API harness only permits http://127.0.0.1:55421')
anon_key = manifest['ANON_KEY']
service_key = manifest['SERVICE_ROLE_KEY']
created_ids = []


def request(method, path, payload=None, token=None, service=False):
    headers = {'apikey': service_key if service else anon_key,
               'Authorization': 'Bearer ' + (token or (service_key if service else anon_key)),
               'Content-Type': 'application/json', 'Prefer': 'return=representation'}
    data = None if payload is None else json.dumps(payload).encode()
    query = urllib.request.Request(api_url + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(query, timeout=20) as response:
            status, body = response.status, response.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    return status, json.loads(body) if body else None


def require(status, expected, label, body=None):
    if status != expected:
        # Do not print response bodies: auth responses may contain access tokens.
        code = body.get('code', '') if isinstance(body, dict) else ''
        raise RuntimeError(f'{label}: expected HTTP {expected}, got {status}, code={code}')


def state(profile_id):
    status, body = request('GET', f'/rest/v1/profiles?id=eq.{profile_id}&select=id,full_name,role,is_active', service=True)
    require(status, 200, 'Trusted fictional profile read', body)
    if not isinstance(body, list) or len(body) != 1:
        raise RuntimeError('Fictional profile read must return exactly one row')
    return body[0]


def fixture(role, active):
    email = f'profile-guard-{uuid.uuid4().hex}@fiction.invalid'
    password = secrets.token_hex(24)
    # user_metadata is user-controlled. Its role must never replace the actual
    # authenticated database role or the authoritative public.profiles role.
    status, body = request('POST', '/auth/v1/admin/users',
                           {'email': email, 'password': password, 'email_confirm': True,
                            'user_metadata': {'full_name': 'Fiction profile API', 'role': 'service_role', 'is_active': True}},
                           service=True)
    require(status, 200, 'Create unique fictional auth account', body)
    profile_id = body['id']
    created_ids.append(profile_id)
    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{profile_id}',
                           {'role': role, 'is_active': active}, service=True)
    require(status, 200, 'Trusted fictional profile setup', body)
    status, body = request('POST', '/auth/v1/token?grant_type=password', {'email': email, 'password': password})
    require(status, 200, 'Native password login', body)
    token = body['access_token']
    encoded = token.split('.')[1]
    claims = json.loads(base64.urlsafe_b64decode(encoded + '=' * (-len(encoded) % 4)))
    if claims.get('role') != 'authenticated' or claims.get('user_metadata', {}).get('role') != 'service_role':
        raise RuntimeError('Native JWT must keep authenticated role despite user-controlled role metadata')
    return profile_id, token


def denied(profile_id, token, payload, expected_status=403, expected_code='42501'):
    before = state(profile_id)
    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{profile_id}', payload, token=token)
    require(status, expected_status, 'Protected fictional profile PATCH', body)
    if not isinstance(body, dict) or body.get('code') != expected_code:
        raise RuntimeError('Protected profile PATCH returned an unexpected error contract')
    if state(profile_id) != before:
        raise RuntimeError('Denied native profile PATCH changed stored data')


try:
    disabled = [fixture(role, False) for role in ['FINANCE', 'OWNER', 'ADMIN']]
    staff_id, staff_token = fixture('STAFF', True)
    admin_id, admin_token = fixture('ADMIN', True)
    target_id, _ = fixture('STAFF', True)
    for profile_id, token in disabled:
        denied(profile_id, token, {'is_active': True})
        denied(profile_id, token, {'is_active': True, 'role': 'STAFF'}, 400, 'P0001')
        denied(profile_id, token, {'full_name': 'Fiction forbidden disabled edit'})
    # Disabled OWNER and ADMIN still reach target rows under legacy is_admin()
    # RLS, but neither personal nor account-administration edits may succeed.
    for _, token in disabled[1:]:
        denied(target_id, token, {'full_name': 'Fiction forbidden disabled admin'})
        denied(disabled[0][0], token, {'is_active': True})
    print('PASS: native JWT disabled FINANCE/OWNER/ADMIN PATCH denied and unchanged despite role metadata', flush=True)

    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{staff_id}',
                           {'full_name': 'Fiction active staff personal edit'}, token=staff_token)
    require(status, 200, 'Active STAFF personal profile edit', body)
    if state(staff_id)['full_name'] != 'Fiction active staff personal edit':
        raise RuntimeError('Active STAFF personal edit did not persist')
    denied(staff_id, staff_token, {'is_active': False})
    denied(staff_id, staff_token, {'role': 'OWNER'}, 400, 'P0001')
    print('PASS: native active STAFF personal PATCH succeeds; activation and self-role edits denied', flush=True)

    token_parts = staff_token.split('.')
    raw_claims = json.loads(base64.urlsafe_b64decode(token_parts[1] + '=' * (-len(token_parts[1]) % 4)))
    raw_claims['role'] = 'service_role'
    token_parts[1] = base64.urlsafe_b64encode(json.dumps(raw_claims).encode()).decode().rstrip('=')
    before = state(staff_id)
    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{staff_id}', {'role': 'OWNER'}, token='.'.join(token_parts))
    require(status, 401, 'Tampered JWT service_role claim', body)
    if state(staff_id) != before:
        raise RuntimeError('Tampered JWT changed profile')
    print('PASS: tampered top-level service_role JWT rejected by signature verification', flush=True)

    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{disabled[0][0]}', {'is_active': True}, token=admin_token)
    require(status, 200, 'Active ADMIN enables another account', body)
    if not state(disabled[0][0])['is_active']:
        raise RuntimeError('Active ADMIN did not enable target account')
    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{target_id}', {'role': 'DOCTOR'}, token=admin_token)
    require(status, 200, 'Active ADMIN assigns another account role', body)
    if state(target_id)['role'] != 'DOCTOR':
        raise RuntimeError('Active ADMIN role assignment did not persist')
    status, body = request('PATCH', f'/rest/v1/profiles?id=eq.{disabled[1][0]}', {'is_active': True}, service=True)
    require(status, 200, 'Trusted local service enables another account', body)
    if not state(disabled[1][0])['is_active']:
        raise RuntimeError('Trusted local service profile administration did not persist')
    print('PASS: native active ADMIN administration and trusted local service_role remain supported', flush=True)
finally:
    failures = 0
    for profile_id in reversed(created_ids):
        status, body = request('DELETE', '/auth/v1/admin/users/' + profile_id, service=True)
        if status not in [200, 204]:
            failures += 1
    if failures:
        raise RuntimeError(f'Could not clean up {failures} uniquely created fictional auth accounts')
    if created_ids:
        status, body = request('GET', '/rest/v1/profiles?id=in.(' + ','.join(created_ids) + ')&select=id', service=True)
        require(status, 200, 'Verify fictional profile cleanup', body)
        if body != []:
            raise RuntimeError('Deleted fictional auth accounts left profiles behind')
        print('PASS: unique fictional API accounts cleaned up', flush=True)
