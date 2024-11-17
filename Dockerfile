# Use Node.js LTS (Long Term Support) as base image
FROM node:20-slim

# Install required system dependencies and FFmpeg
RUN apt-get update && apt-get install -y \
    ffmpeg \
    yt-dlp \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Install yt-dlp
#RUN pip3 install yt-dlp

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy app source
COPY . .

# Create public directory for static files
RUN mkdir -p public

# Create RAM directory if it doesn't exist (though /dev/shm will be handled by Docker)
RUN mkdir -p /dev/shm

# Expose the port the app runs on
EXPOSE 3000

# Command to run the application
CMD ["node", "server.js"]
