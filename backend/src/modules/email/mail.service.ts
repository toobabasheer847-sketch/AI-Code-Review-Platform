import nodemailer from 'nodemailer'
import { env } from '../../config/env.js'
import { ReviewCompletePayload } from './email.types.js'
import type { AutomationNotificationPayload } from './email.types.js'
import type { AccountEmailPayload, VerificationOtpEmailPayload } from './account-email.types.js'
import {
	renderWorkspaceInvitationEmail,
	type WorkspaceInvitationEmailMessage,
} from './workspace-invitation-email.js'
import fs from 'fs'
import path from 'path'

export type MailConfiguration = Pick<
	typeof env,
	'MAIL_HOST' | 'MAIL_PORT' | 'MAIL_USER' | 'MAIL_PASSWORD' | 'MAIL_FROM'
>

export class MailConfigurationError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'MailConfigurationError'
	}
}

export function validateMailConfiguration(configuration: MailConfiguration = env): void {
	const hasPlaceholder = (value: string): boolean =>
		/(replace-with|your-|placeholder|example)/i.test(value)
	const missing = [
		!configuration.MAIL_HOST && 'MAIL_HOST',
		!Number.isInteger(configuration.MAIL_PORT) || configuration.MAIL_PORT < 1 || configuration.MAIL_PORT > 65535
			? 'MAIL_PORT'
			: undefined,
		!configuration.MAIL_USER && 'MAIL_USER',
		!configuration.MAIL_PASSWORD && 'MAIL_PASSWORD',
		!configuration.MAIL_FROM && 'MAIL_FROM',
		hasPlaceholder(configuration.MAIL_USER) && 'MAIL_USER',
		hasPlaceholder(configuration.MAIL_PASSWORD) && 'MAIL_PASSWORD',
	].filter((name): name is string => Boolean(name))
	if (missing.length > 0) {
		throw new MailConfigurationError(`Missing or invalid mail configuration: ${missing.join(', ')}`)
	}
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuration.MAIL_USER) ||
		!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuration.MAIL_FROM) || configuration.MAIL_HOST.toLowerCase() === 'smtp.gmail.com')) {
		throw new MailConfigurationError('MAIL_USER and MAIL_FROM must be valid email addresses')
	}
}

export function getSafeMailErrorDetails(error: unknown): {
	errorType: string
	errorCode?: string | number
	command?: string
	responseCode?: number
} {
	const property = (name: string): string | number | undefined => {
		if (typeof error !== 'object' || error === null || !(name in error)) return undefined
		const value: unknown = Reflect.get(error, name)
		return typeof value === 'string' || typeof value === 'number' ? value : undefined
	}
	const errorCode = property('code')
	const command = property('command')
	const responseCode = property('responseCode')
	return {
		errorType: error instanceof Error ? error.name : 'UnknownError',
		...(errorCode !== undefined ? { errorCode } : {}),
		...(typeof command === 'string' ? { command } : {}),
		...(typeof responseCode === 'number' ? { responseCode } : {}),
	}
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => {
		const entities: Record<string, string> = {
			'&': '&amp;',
			'<': '&lt;',
			'>': '&gt;',
			'"': '&quot;',
			"'": '&#39;',
		}
		return entities[character]
	})
}

export class MailService {
	private transporter
	private readonly configuration: MailConfiguration

	constructor(configuration: MailConfiguration = env) {
		validateMailConfiguration(configuration)
		this.configuration = configuration
		this.transporter = nodemailer.createTransport({
			host: configuration.MAIL_HOST,
			port: configuration.MAIL_PORT,
			secure: configuration.MAIL_PORT === 465,
			auth: {
				user: configuration.MAIL_USER,
				pass: configuration.MAIL_PASSWORD,
			},
		})
	}

	private get fromAddress(): string {
		return this.configuration.MAIL_HOST.toLowerCase() === 'smtp.gmail.com'
			? this.configuration.MAIL_USER
			: this.configuration.MAIL_FROM
	}

	public async sendReviewComplete(payload: ReviewCompletePayload) {
		const templatePath = path.join(__dirname, 'templates', 'review-complete.html')
		let html = ''
		try {
			html = fs.readFileSync(templatePath, 'utf8')
		} catch {
			html = '<p>Your review is ready: {{repository}} - Score: {{score}}</p>'
		}

		const htmlWithData = html.replace(/{{repository}}/g, escapeHtml(payload.repository))
			.replace(
				/{{score}}/g,
				escapeHtml(payload.score === null ? 'Not available' : `${payload.score} (heuristic)`)
			)
			.replace(/{{issues}}/g, escapeHtml(String(payload.issues)))
			.replace(/{{summary}}/g, escapeHtml(payload.summary))
			.replace(/{{reviewUrl}}/g, escapeHtml(payload.reviewUrl ?? '#'))

		const info = await this.transporter.sendMail({
			from: this.fromAddress,
			to: payload.to,
			subject: `Your code review for ${payload.repository} is ready`,
			html: htmlWithData,
		})

		return info
	}

	public async sendEmailVerification(payload: VerificationOtpEmailPayload) {
		const otp = escapeHtml(payload.otp)
		return this.transporter.sendMail({
			from: this.fromAddress,
			to: payload.to,
			subject: 'Your AI CodeGuard verification code',
			text: `Your AI CodeGuard verification code is ${otp}. It expires in 10 minutes. If you did not create this account, you can ignore this message.`,
			html: `<p>Enter this verification code to confirm your email address:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${otp}</p><p>This code expires in 10 minutes. If you did not create this account, you can ignore this message.</p>`,
		})
	}

	public async sendPasswordReset(payload: AccountEmailPayload) {
		const url = escapeHtml(payload.url)
		return this.transporter.sendMail({
			from: this.fromAddress,
			to: payload.to,
			subject: 'Reset your AI CodeGuard password',
			html: `<p>A password reset was requested for your account.</p><p><a href="${url}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request a reset, you can ignore this message.</p>`,
		})
	}

	public async sendWorkspaceInvitation(payload: WorkspaceInvitationEmailMessage) {
		const templatePath = path.join(__dirname, 'templates', 'workspace-invitation.html')
		let template = '<p>{{inviterName}} invited you to {{workspaceName}} as a {{roleLabel}}.</p><p>Expires {{expiresAt}}.</p><p><a href="{{acceptUrl}}">Accept invitation</a></p>'
		try {
			template = fs.readFileSync(templatePath, 'utf8')
		} catch {
			// The inline fallback still contains the same invitation fields.
		}
		const rendered = renderWorkspaceInvitationEmail(template, payload)
		return this.transporter.sendMail({
			from: this.fromAddress,
			to: payload.to,
			subject: rendered.subject,
			text: rendered.text,
			html: rendered.html,
		})
	}

	public async sendAutomationNotification(payload: AutomationNotificationPayload) {
		const details = payload.details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')
		const url = escapeHtml(payload.url)
		return this.transporter.sendMail({
			from: this.fromAddress,
			to: payload.to,
			subject: payload.subject,
			html: `<h1>${escapeHtml(payload.heading)}</h1><ul>${details}</ul><p><a href="${url}">Open AI CodeGuard</a></p>`,
		})
	}
}
