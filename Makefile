# AgentFlow - Developer Makefile
# SPManchester Private Limited (https://spmanchester.com)

.PHONY: help install start seed test check docker-build docker-up docker-down

help:
	@echo "AgentFlow Automation Commands - SPManchester Private Limited"
	@echo "------------------------------------------------------------"
	@echo "make start        - Start the AgentFlow server (port 4000)"
	@echo "make seed         - Re-seed the SQLite database with default fixtures"
	@echo "make test         - Run full 50-check end-to-end HTTP test suite"
	@echo "make check        - Run syntax checks across all JS files"
	@echo "make docker-build - Build production Docker image"
	@echo "make docker-up    - Run container via docker-compose"
	@echo "make docker-down  - Stop running docker containers"

start:
	node backend/src/server.js

seed:
	node backend/src/seed.js

test:
	node tests/run-tests.js

check:
	npm run check

docker-build:
	docker build -t spmanchester/agentflow:latest .

docker-up:
	docker compose up -d

docker-down:
	docker compose down
