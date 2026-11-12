import assert from 'node:assert/strict'
import test from 'node:test'
import { auditActions, auditEventData } from './audit.service'

test('audit records keep actor, tenant, action, resource, and no credential fields', () => {
  const data = auditEventData({
    actorId: 'user-1',
    organizationId: 'org-1',
    workspaceId: 'ws-1',
    action: auditActions.membershipRoleChanged,
    resourceType: 'membership',
    resourceId: 'member-1',
  })
  assert.deepEqual(Object.keys(data).sort(), [
    'action',
    'actorId',
    'organizationId',
    'resourceId',
    'resourceType',
    'workspaceId',
  ])
  assert.equal(JSON.stringify(data).includes('password'), false)
  assert.equal(JSON.stringify(data).includes('token'), false)
  assert.equal(JSON.stringify(data).includes('secret'), false)
})

test('audit records reject unknown actions and free-form resource types', () => {
  assert.throws(
    () =>
      auditEventData({
        action: 'auth.password' as 'auth.logout',
        resourceType: 'session',
      }),
    /Unsupported audit action/
  )
  assert.throws(
    () =>
      auditEventData({
        action: auditActions.loginFailed,
        resourceType: 'password',
      }),
    /Unsupported audit resource/
  )
})
