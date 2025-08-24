# Gunakan base image Node.js versi sesuai package.json
FROM node:22

# Set workdir di dalam container
WORKDIR /app

# Copy package.json dan package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy seluruh project ke container
COPY . .

# Expose port (Express pakai 3000)
EXPOSE 3000

# Jalankan server.js
CMD ["npm", "start"]