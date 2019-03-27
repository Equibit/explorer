# FROM mhart/alpine-node:10.15.0
FROM node:10.15.0

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . ./

EXPOSE 3001

CMD [ "npm", "start" ]