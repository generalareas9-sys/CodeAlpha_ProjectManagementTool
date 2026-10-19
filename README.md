# Taskora — Project Management Tool

Taskora is a web-based project management application designed to help individuals and teams organize projects, manage tasks, collaborate efficiently, and track progress in one place. It provides a centralized workspace with project boards, task assignments, comments, notifications, and real-time updates.

## 🚀 Features

- **Dashboard:** View project and task statistics, including upcoming and overdue tasks.
- **Project Management:** Create and organize projects and collaborate with team members.
- **Task Management:** Create, assign, prioritize, and update tasks.
- **Kanban Board:** Organize tasks into columns and move them using drag and drop.
- **Task Details:** Manage task information, checklists, assignments, and comments.
- **Team Collaboration:** Invite members and communicate through task comments and mentions.
- **Real-Time Updates:** Keep project information synchronized across connected users.
- **Notifications:** Receive notifications about relevant project and task activities.
- **Multiple Views:** Switch between Board, List, and Calendar views.
- **Theme Support:** Use light and dark themes.
- **Authentication:** Access the application through user accounts.

## 🛠️ Technology Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js and Express.js
- **Database:** SQLite with `better-sqlite3`
- **Real-Time Communication:** Socket.IO
- **Authentication:** JSON Web Tokens (JWT)
- **Configuration:** dotenv

## 📋 Requirements

Before running Taskora, install:

- [Node.js](https://nodejs.org/) — Node.js 22 LTS is recommended.
- npm — included with Node.js.

## ⚙️ Installation and Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/generalareas9-sys/CodeAlpha_ProjectManagementTool.git
   ```

2. Navigate to the project directory:

   ```bash
   cd CodeAlpha_ProjectManagementTool
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, you can use:

   ```powershell
   Copy-Item .env.example .env
   ```

5. Open `.env` and configure the required environment variables. Set a strong, unique `JWT_SECRET`. Never commit your `.env` file to GitHub.

6. Initialize the demo data:

   ```bash
   npm run seed
   ```

7. Start the application:

   ```bash
   npm start
   ```

8. Open your browser and visit:

   http://localhost:5000

## 🧪 Testing

Run the available API tests with:

```bash
npm test
```

Test availability depends on the development dependencies being installed.

## 🔐 Security Notes

- Keep environment variables and secrets private.
- Do not commit local database files or database journal files.
- Use a strong, unique JWT secret.
- Use appropriate access controls when deploying the application.
- Change demo credentials and disable or remove demo accounts before production deployment.

## 📁 Project Structure

```text
CodeAlpha_ProjectManagementTool/
├── public/                 # Frontend assets
├── src/
│   └── routes/             # Application API routes
├── scripts/                # Database seeding scripts
├── screenshots/            # Application screenshots
├── data/                   # Local database files (not for GitHub)
├── server.js               # Application entry point
├── package.json            # Dependencies and scripts
├── .env.example            # Environment configuration template
├── .gitignore              # Git exclusion rules
└── README.md               # Project documentation
```

## 📸 Screenshots

Application screenshots can be added here to demonstrate the dashboard, project board, task details, and other features.

## 🎯 Project Objective

Taskora aims to simplify project organization and team collaboration by bringing project planning, task tracking, and communication into a single web application.

## 👨‍💻 Author

**generalareas9-sys**

GitHub: [@generalareas9-sys](https://github.com/generalareas9-sys)

## 📄 License

See the [LICENSE](LICENSE) file for licensing information.
