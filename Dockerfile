FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install --production

COPY . .

# Crear la carpeta de datos si no existe
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "server.js"]