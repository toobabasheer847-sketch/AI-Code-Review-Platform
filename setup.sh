#!/usr/bin/env bash

# AI-CodeGuard Quick Start Script
# This script helps set up the development environment

set -e

echo "🚀 AI-CodeGuard Development Environment Setup"
echo "=============================================="
echo ""

# Check Node.js
echo "✓ Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "✗ Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi
NODE_VERSION=$(node -v)
echo "  Node.js version: $NODE_VERSION"

# Check npm
echo "✓ Checking npm..."
if ! command -v npm &> /dev/null; then
    echo "✗ npm is not installed"
    exit 1
fi
NPM_VERSION=$(npm -v)
echo "  npm version: $NPM_VERSION"

# Check Docker (optional)
if command -v docker &> /dev/null; then
    echo "✓ Docker is installed"
    DOCKER_COMPOSE_VERSION=$(docker-compose --version 2>/dev/null || echo "Not found")
    echo "  Docker Compose: $DOCKER_COMPOSE_VERSION"
fi
echo ""

# Setup environment files
echo "📝 Setting up environment files..."
if [ ! -f ".env" ]; then
    cp .env.example .env
    echo "  Created .env"
else
    echo "  .env already exists"
fi

if [ ! -f "frontend/.env" ]; then
    cp frontend/.env.example frontend/.env
    echo "  Created frontend/.env"
else
    echo "  frontend/.env already exists"
fi

if [ ! -f "backend/.env" ]; then
    cp backend/.env.example backend/.env
    echo "  Created backend/.env"
else
    echo "  backend/.env already exists"
fi
echo ""

# Install dependencies
echo "📦 Installing dependencies..."
npm install
echo "  ✓ Root dependencies installed"
echo ""

# Generate Prisma Client
echo "🔧 Setting up backend..."
cd backend
npm run prisma:generate
echo "  ✓ Prisma Client generated"
cd ..
echo ""

echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "============"
echo ""
echo "Option 1: Using Docker (Recommended)"
echo "  docker-compose up"
echo ""
echo "Option 2: Manual Development"
echo "  Terminal 1: cd backend && npm run dev"
echo "  Terminal 2: cd frontend && npm run dev"
echo ""
echo "Access the application:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:3001"
echo "  Health:   http://localhost:3001/health"
echo ""
