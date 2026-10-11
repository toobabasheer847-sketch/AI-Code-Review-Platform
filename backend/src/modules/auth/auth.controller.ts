import { Request, Response } from 'express'
import { AuthService } from './auth.service'
import { loginSchema, registerSchema } from './auth.validation'

const authService = new AuthService()

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    try {
      const input = registerSchema.parse(req.body)
      const result = await authService.register(input)
      res.status(201).json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed'
      res.status(400).json({ error: message })
    }
  }

  async login(req: Request, res: Response): Promise<void> {
    try {
      const input = loginSchema.parse(req.body)
      const result = await authService.login(input)
      res.json(result)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed'
      res.status(400).json({ error: message })
    }
  }

  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user?.userId) {
        res.status(401).json({ error: 'Unauthorized' })
        return
      }

      const user = await authService.getCurrentUser(req.user.userId)
      res.json({ user })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch user'
      res.status(400).json({ error: message })
    }
  }

  async logout(req: Request, res: Response): Promise<void> {
    try {
      if (req.user?.userId) {
        await authService.logout()
      }
      res.json({ message: 'Logged out successfully' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Logout failed'
      res.status(400).json({ error: message })
    }
  }
}
