import assert from 'node:assert/strict'
import test from 'node:test'
import { loginSchema, registerSchema, resetPasswordSchema } from './auth.validation'

test('new passwords require a letter and a number while existing logins keep the length check', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@example.com', password: 'password' }).success, true)
  assert.equal(
    registerSchema.safeParse({
      email: 'a@example.com',
      password: 'password',
      fullName: 'Ada Lovelace',
    }).success,
    false
  )
  assert.equal(
    registerSchema.safeParse({
      email: 'a@example.com',
      password: 'password1',
      fullName: 'Ada Lovelace',
    }).success,
    true
  )
  assert.equal(
    resetPasswordSchema.safeParse({ token: 'a'.repeat(32), password: 'password' }).success,
    false
  )
  assert.equal(
    resetPasswordSchema.safeParse({ token: 'a'.repeat(32), password: 'password1' }).success,
    true
  )
})
