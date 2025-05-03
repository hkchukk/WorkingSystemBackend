FROM oven/bun:alpine

COPY . .

RUN bun install

CMD ["bun", "run", "dev"]
