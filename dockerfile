FROM oven/bun:alpine

# 安裝 CA 憑證以解決 SSL 驗證問題
RUN apk add --no-cache ca-certificates

WORKDIR /app

COPY . .

RUN bun install

EXPOSE 3000

CMD ["bun", "run", "start"]
