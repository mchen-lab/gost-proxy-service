# Gost Proxy Service

This project was bootstrapped with [@mchen-lab/app-kit](https://github.com/mchen-lab/app-kit).

## Getting Started

1.  **Install Dependencies**
    ```bash
    npm install
    ```

2.  **Initialize Git (Recommended)**
    To capture the commit hash for the "About" dialog, initialize a git repository and make an initial commit:
    ```bash
    git init && git add . && git commit -m "initial commit"
    ```

3.  **Start Development Server**
    Use the provided `restart.sh` script to start the server. This script handles port cleanup and log rotation:
    ```bash
    ./restart.sh
    ```
    Alternatively, you can run `npm run dev`.

4.  **Build for Production**
    ```bash
    npm run build
    ```

## Project Structure

-   `src/server`: Backend logic (Express + AppKit).
-   `src/frontend`: Frontend React application.
-   `libs`: Local dependencies (e.g., `app-kit.tgz`).
-   `data`: Persistent data storage.
-   `logs`: Application logs.
