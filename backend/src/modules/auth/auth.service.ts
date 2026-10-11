import { prisma } from '@/config/database'
import { hashPassword, comparePassword } from '@/utils/bcrypt'
import { generateToken as generateJWT } from '@/utils/jwt'
import type { LoginInput, RegisterInput } from './auth.validation'
import type { AuthResponse, UserResponse } from './auth.types'

export class AuthService {
  private toUserResponse(user: {
    id: string
    email: string
    fullName: string
    avatar: string | null
    isVerified: boolean
    createdAt: Date
    updatedAt: Date
    githubAccount?: {
      username: string
    } | null
  }): UserResponse {
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      avatar: user.avatar,
      isVerified: user.isVerified,
      githubConnected: !!user.githubAccount,
      githubUsername: user.githubAccount?.username ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: {
        githubAccount: {
          select: {
            username: true,
          },
        },
      },
    })

    if (!user) {
      throw new Error('Invalid email or password')
    }

    const isValidPassword = await comparePassword(input.password, user.passwordHash)
    if (!isValidPassword) {
      throw new Error('Invalid email or password')
    }

    const token = generateJWT({
      userId: user.id,
      email: user.email,
    })

    return {
      token,
      user: this.toUserResponse(user),
    }
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email },
    })

    if (existingUser) {
      throw new Error('Email already registered')
    }

    const passwordHash = await hashPassword(input.password)

    const user = await prisma.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        passwordHash,
      },
    })

    const token = generateJWT({
      userId: user.id,
      email: user.email,
    })

    return {
      token,
      user: this.toUserResponse(user),
    }
  }

  async getCurrentUser(userId: string): Promise<UserResponse> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        githubAccount: {
          select: {
            username: true,
          },
        },
      },
    })

    if (!user) {
      throw new Error('User not found')
    }

    return this.toUserResponse(user)
  }

  async logout(): Promise<void> {
    // Logout is handled client-side by removing token
    // Token blacklist can be implemented with Redis if needed
  }
}
