@echo off
REM AI-CodeGuard Quick Start Script for Windows

echo.
echo 🚀 AI-CodeGuard Development Environment Setup
echo ============================================
echo.

REM Check Node.js
echo Checking Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo ✗ Node.js is not installed. Please install Node.js ^>= 18.0.0
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo   Node.js version: %NODE_VERSION%

REM Check npm
echo Checking npm...
where npm >nul 2>nul
if errorlevel 1 (
    echo ✗ npm is not installed
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo   npm version: %NPM_VERSION%

REM Check Docker (optional)
where docker >nul 2>nul
if not errorlevel 1 (
    echo ✓ Docker is installed
)
echo.

REM Setup environment files
echo Setting up environment files...
if not exist ".env" (
    copy .env.example .env
    echo   Created .env
) else (
    echo   .env already exists
)

if not exist "frontend\.env" (
    copy frontend\.env.example frontend\.env
    echo   Created frontend\.env
) else (
    echo   frontend\.env already exists
)

if not exist "backend\.env" (
    copy backend\.env.example backend\.env
    echo   Created backend\.env
) else (
    echo   backend\.env already exists
)
echo.

REM Install dependencies
echo Installing dependencies...
call npm install
echo   ✓ Root dependencies installed
echo.

REM Generate Prisma Client
echo Setting up backend...
cd backend
call npm run prisma:generate
echo   ✓ Prisma Client generated
cd ..
echo.

echo ✅ Setup complete!
echo.
echo Next steps:
echo ============
echo.
echo Option 1: Using Docker (Recommended)
echo   docker-compose up
echo.
echo Option 2: Manual Development
echo   Terminal 1: cd backend ^&^& npm run dev
echo   Terminal 2: cd frontend ^&^& npm run dev
echo.
echo Access the application:
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:3001
echo   Health:   http://localhost:3001/health
echo.
