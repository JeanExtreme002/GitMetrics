.DEFAULT_GOAL := help
.PHONY: help install dev build start test coverage lint format typecheck check pack clean

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## Install dependencies
	npm ci

dev: ## Run the API and the web app with hot reload
	npm run dev

build: ## Build the web app and the CLI into dist/
	npm run build

start: build ## Build and run MyGitDash like a user would
	npm start

test: ## Run the test suite
	npm test

coverage: ## Run the tests with a coverage report
	npm run test:coverage

lint: ## Lint the code
	npm run lint

format: ## Format the code with Prettier
	npm run format

typecheck: ## Type-check the whole project
	npm run typecheck

check: lint typecheck test ## Everything CI runs, in one go
	npm run format:check

pack: build ## Preview the files that would be published to npm
	npm pack --dry-run

clean: ## Remove build output and coverage
	rm -rf dist coverage
