import nodemailer from 'nodemailer'
import { env } from '../../config/env.js'
import { ReviewCompletePayload } from './email.types.js'
import fs from 'fs'
import path from 'path'

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

	constructor() {
		this.transporter = nodemailer.createTransport({
			host: env.MAIL_HOST,
			port: env.MAIL_PORT,
			auth: {
				user: env.MAIL_USER,
				pass: env.MAIL_PASSWORD,
			},
		})
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
			.replace(/{{score}}/g, escapeHtml(String(payload.score)))
			.replace(/{{issues}}/g, escapeHtml(String(payload.issues)))
			.replace(/{{summary}}/g, escapeHtml(payload.summary))
			.replace(/{{reviewUrl}}/g, escapeHtml(payload.reviewUrl ?? '#'))

		const info = await this.transporter.sendMail({
			from: env.MAIL_FROM,
			to: payload.to,
			subject: `Your code review for ${payload.repository} is ready`,
			html: htmlWithData,
		})

		return info
	}
}
