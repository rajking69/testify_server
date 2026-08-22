# Testify Server 

Testify Server is an Express.js & TypeScript backend for the **Testify** platform. It provides MongoDB connectivity, authentication powered by Better Auth, and RESTful API endpoints.

## 🛠 Tech Stack

- **Runtime & Framework:** Node.js, Express.js, TypeScript
- **Database:** MongoDB, Mongoose
- **Authentication:** Better Auth (MongoDB Adapter)
- **Dev Tooling:** `tsx` for fast hot reloading, `dotenv`

---

## 🚀 Getting Started

### 1. Prerequisites

- Node.js (v18 or higher)
- MongoDB Atlas cluster or local MongoDB instance

### 2. Environment Variables

Create a `.env` file in the root directory based on `.env.example`:

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
MONGODB_DB_NAME=testify
BETTER_AUTH_SECRET=your_secret_key
BETTER_AUTH_URL=http://localhost:5000
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3000
```

### 3. Installation

```bash
npm install
```

### 4. Development Server

Run the development server with auto-reload (`tsx watch`):

```bash
npm run dev
```

### 5. Build & Production

```bash
npm run build
npm start
```

---

## 🔐 Authentication Endpoints

- `POST /api/auth/sign-up/email` - Register new user
- `POST /api/auth/sign-in/email` - Login existing user
- `GET /api/auth/get-session` - Get current user session
- `POST /api/auth/sign-out` - Logout user

---

## 📜 License

ISC
