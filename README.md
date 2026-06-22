# AI-CodeGuard - Production-Level SaaS Code Review Platform

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.3%2B-blue.svg)

AI-CodeGuard is an enterprise-grade, full-stack SaaS platform for automated code review using artificial intelligence. Leveraging OpenAI's GPT models and LangChain, it provides comprehensive code analysis with real-time collaboration features.

## 🚀 Features

- **AI-Powered Code Review**: Automated analysis using OpenAI GPT models
- **Real-time Collaboration**: Socket.io powered chat and discussions
- **GitHub Integration**: Seamless GitHub repository integration with OAuth
- **Subscription Billing**: Stripe integration for payment processing
- **Background Jobs**: BullMQ for async processing of reviews and emails
- **Real-time Analytics**: Dashboard with comprehensive insights
- **Enterprise Security**: JWT authentication, encryption, CORS, and helmet protection
- **Multi-language Support**: Support for various programming languages
- **Email Notifications**: Nodemailer integration for alerts and notifications
- **Redis Caching**: High-performance caching layer

## 📁 Project Structure

```
AI-CodeGuard/
├── frontend/                 # React + Vite application
│   ├── src/
│   │   ├── app/             # Application root
│   │   ├── components/      # Reusable React components
│   │   ├── features/        # Feature-specific modules
│   │   ├── lib/             # Utilities and configurations
│   │   └── types/           # TypeScript type definitions
│   └── package.json
└── backend/                 # Express + Next.js API server
    ├── src/
    │   ├── app/             # Express application setup
    │   ├── config/          # Configuration files
    │   ├── modules/         # Feature modules
    │   ├── middleware/      # Custom middleware
    │   ├── utils/           # Utility functions
    │   └── prisma/          # Database schema and migrations
    └── package.json
```

## 🛠️ Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** - Next generation build tool
- **TanStack Query** - Data fetching and caching
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first CSS framework
- **Shadcn UI** - Accessible component library
- **Zustand** - Lightweight state management
- **Framer Motion** - Animation library
- **Recharts** - Data visualization
- **Zod** - Schema validation
- **React Hook Form** - Form state management

### Backend
- **Express.js** - Web framework
- **Next.js** - React meta-framework (optional for API routes)
- **TypeScript** - Type safety
- **Prisma ORM** - Database abstraction
- **PostgreSQL** - Relational database
- **Redis** - Caching and job queue storage
- **BullMQ** - Background job processing
- **OpenAI API** - AI-powered code analysis
- **LangChain** - LLM orchestration framework
- **Socket.io** - Real-time bidirectional communication
- **JWT** - Authentication tokens
- **Stripe** - Payment processing
- **Nodemailer** - Email service
- **GitHub OAuth** - Social authentication

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/ai-codeguard.git
cd ai-codeguard
```

2. **Setup Environment Variables**
```bash
cp .env.example .env.local
# Edit .env.local with your configuration
```

3. **Setup Frontend**
```bash
cd frontend
npm install
npm run dev
```

4. **Setup Backend**
```bash
cd backend
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run dev
```

5. **Access Application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- API Documentation: http://localhost:3001/api/docs

### Docker Setup

```bash
# Build and run with Docker Compose
docker-compose up -d

# Run migrations
docker-compose exec backend npm run prisma:migrate

# Seed database
docker-compose exec backend npm run seed
```

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/github/callback` - GitHub OAuth callback

### Code Review Endpoints
- `GET /api/reviews` - List reviews
- `POST /api/reviews` - Create new review
- `GET /api/reviews/:id` - Get review details
- `PUT /api/reviews/:id` - Update review
- `DELETE /api/reviews/:id` - Delete review

### Repository Endpoints
- `GET /api/repositories` - List repositories
- `POST /api/repositories` - Connect repository
- `GET /api/repositories/:id` - Get repository details
- `DELETE /api/repositories/:id` - Disconnect repository

### AI Endpoints
- `POST /api/ai/analyze` - Analyze code with AI
- `POST /api/ai/chat` - Chat about code review

## 🔐 Environment Variables

See `.env.example` for all required environment variables. Key variables:

- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - Secret key for JWT signing
- `OPENAI_API_KEY` - OpenAI API key
- `GITHUB_CLIENT_ID/SECRET` - GitHub OAuth credentials
- `STRIPE_SECRET_KEY` - Stripe API key

## 🧪 Testing

```bash
# Frontend tests
cd frontend
npm run test

# Backend tests
cd backend
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

## 📝 Code Quality

```bash
# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format

# Type checking
npm run type-check
```

## 🔄 CI/CD

This project uses GitHub Actions for continuous integration. See `.github/workflows/` for pipeline configuration.

## 🤝 Contributing

1. Create a feature branch (`git checkout -b feature/AmazingFeature`)
2. Commit changes (`git commit -m 'Add some AmazingFeature'`)
3. Push to branch (`git push origin feature/AmazingFeature`)
4. Open a Pull Request

### Commit Convention

Uses conventional commits:
```
feat: Add new feature
fix: Fix bug
docs: Update documentation
style: Code style changes
refactor: Code refactoring
perf: Performance improvements
test: Add tests
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

For support, email support@ai-codeguard.com or open an issue on GitHub.

## 🗺️ Roadmap

- [ ] Advanced AI model support
- [ ] Team collaboration features
- [ ] IDE plugins (VS Code, JetBrains)
- [ ] Custom AI models training
- [ ] API rate limiting dashboard
- [ ] Multi-language support
- [ ] Mobile app (React Native)
- [ ] CLI tool for local analysis

## 👨‍💻 Authors

- [Your Name](https://github.com/yourusername)

## 🙏 Acknowledgments

- OpenAI for GPT models
- Vercel for Prisma
- The React and Node.js communities
