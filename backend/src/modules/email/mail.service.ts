import nodemailer from 'nodemailer'
import { env } from '@/config/env'
import { ReviewCompletePayload } from './email.types'
import fs from 'fs'
import path from 'path'

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
			html = `<p>Your review is ready: ${payload.repository} - Score: ${payload.score}</p>`
		}

		const htmlWithData = html.replace(/{{repository}}/g, payload.repository)
			.replace(/{{score}}/g, String(payload.score))
			.replace(/{{issues}}/g, String(payload.issues))
			.replace(/{{summary}}/g, payload.summary)
			.replace(/{{reviewUrl}}/g, payload.reviewUrl ?? '#')

		const info = await this.transporter.sendMail({
			from: env.MAIL_FROM,
			to: payload.to,
			subject: `Your code review for ${payload.repository} is ready`,
			html: htmlWithData,
		})

		return info
	}
}
