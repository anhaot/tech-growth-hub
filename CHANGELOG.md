# Changelog

## [Unreleased] - 2026-10-08

- 增加 CSV/JSON/Markdown/AI 粘贴导入预览，分页核对、跨页排除、错误明细与确认导入；重复确认返回原结果，预览和提交均检查题库授权。

- Added question version history, difference preview, rollback as a new version, optimistic revision checks, and history-preserving backups/migrations.
- Removed 1000-question learning/navigation and 5000-question duplicate-scan limits; added paged learning, global position restoration, indexed background duplicate scans and paged results.
- Added dense duplicate compaction, explicit top-10000 result limits, scoped history access and atomic permission-checked merges.
- Fixed MariaDB JSON/date handling and MySQL index initialization, learning bookmark retention/counts, persistent AI settings, offline transaction completion, stale requests and page update recovery.
- Fixed restoration of unordered category hierarchies and rejected cyclic category backups.
- Added JSON export alongside Markdown and private atomic database configuration writes; updated implementation and audit documentation.

### Added

- Configurable login lifetimes, custom durations and unlimited sessions in system settings, with immediate application to the current session and persistent browser session restoration.
- Regression coverage for authentication lifetimes, revoked category access, import/export, category cycles, backup rollback, and AI request boundaries.
- A project audit with prioritized feature recommendations and explicit verification limits.

### Fixed

- JWT and cookie durations now follow persisted settings or `JWT_EXPIRES_IN`; both Compose variants pass the environment fallback.
- Password changes revoke old tokens; expired tokens report the correct error, and Bearer precedence matches CSRF validation.
- Full backups require an administrator role; empty restores are rejected and failed restores roll back in SQLite and MySQL.
- Category parents cannot cross libraries or form cycles; bookmarks and learning progress respect revoked access.
- JSON exports can be reimported with tags, categories, empty answers and null explanations; Markdown imports retain multiline question bodies.
- Pagination inputs are bounded, self-merges are rejected, and question exports no longer silently stop at 10,000 records.
- AI URLs require HTTPS, private mapped IPv6 addresses are blocked, redirects are refused, and inference timeouts cover response body reads.
- Homepage view counts are labeled as view counts instead of learning hours; vulnerable dependencies were updated.
- Upgraded React Router to 7.18.4 to resolve production dependency advisories while retaining the existing declarative routing setup; documented remaining development-tool advisories.

All notable changes to Tech Growth Hub will be documented in this file.

The format loosely follows Keep a Changelog, with sections grouped by release.

## [Unreleased]

### Added

- Interview capture inbox with multi-question offline drafts, batch AI answer generation, manual review, and explicit import into the official question bank.
- Responsive study and quiz modes with saved browsing progress, filtering, bookmarks, and mobile controls.
- Installable PWA shell, mobile bottom navigation, safe-area layout, offline interview drafts, browser tests, and real README screenshots.
- Source-build Docker Compose deployment, CI, and health probes.
- AES-256-GCM encryption for persisted AI credentials and exported backups.

- AI model configuration maintenance: model availability checks, invalid-model status badges, and one-click cleanup for invalid model configs.
- Dynamic custom API address templates for saved OpenAI-compatible providers, including template naming and NVIDIA address recognition.
- Reuse of saved custom provider API keys when adding additional models for the same API address.
- Dedicated encrypted API credential management, with model configurations referencing reusable credentials instead of displaying keys.
- Progressive multi-model checks: up to four checks run concurrently, each result is shown immediately, and a final dialog summarizes available, unavailable, unconfirmed, and timed-out models.

### Changed

- AI generation and study assistants now list every configured model while defaulting to the active model.
- Project documentation now presents the product as an AI question-bank, knowledge-governance, and learning platform; browser capture is documented as a supporting input workflow.
- Application images now require date-sequence versions such as `v260805-1`; Compose and release automation no longer use `latest`.
- GitHub Releases now attach a runnable prebuilt bundle, checksum manifest, and separately importable API, Web, and MariaDB Docker archives for amd64 and arm64.

### Fixed

- Fixed model selection paths that could resolve a provider name to its first configuration instead of the selected configuration ID.
- Improved NVIDIA-compatible upstream error handling, long-message layout, and timeout diagnostics.
- Replaced MariaDB's generated internal healthcheck credential with an application-user `SELECT 1` check, avoiding unhealthy containers when an imported or reused data volume contains stale healthcheck credentials.

## [1.1.0] - 2026-04-07

### Added

- `AI答案` workflow for generating answer-only drafts, explanations, and tag suggestions without changing question stem, title, or difficulty
- `AI润色` mode split with `轻润色 / 深润色`, preview-first editing, and selectable tags before save
- AI batch tag generation and tag recommendation workflows for question maintenance
- Shared `AIAnswerDraftModal` component and richer AI text formatting helpers
- Dedicated documentation set under `docs/`, including deployment, operations, development, permissions, AI guide, and user guide

### Changed

- Renamed and reorganized the repository as `tech-growth-hub` with concise `api/`, `web/`, and `compose.yaml` paths.
- Question answers are optional at creation time and can be generated by AI before saving.
- Authentication now keeps the session in an HttpOnly cookie with double-submit CSRF protection; the web app no longer persists bearer tokens.
- Upgraded the build runtime to Node.js 22 and Vite 8, with route-level code splitting and non-root runtime containers.

- Promoted HttpOnly cookie based authentication flow, with web session restore and session-scoped storage fallback
- Reworked README into a full project landing document with product, workflow, operations, and documentation navigation
- Refined AI answer generation to support `速记版 / 练习版 / 教学版` with answer quality, tag selection, and manual tag input
- Improved AI output rendering and formatting for Markdown, numbered lists, and bullet lists
- Updated system settings visibility so backup operations are treated as administrator-only functionality

### Fixed

- Fixed AI route permission boundaries so integrated users cannot bypass category scopes through AI endpoints
- Fixed custom AI provider runtime handling so admins and normal users can use existing safe custom providers correctly
- Fixed AI batch generation parsing to tolerate more model JSON response shapes
- Fixed login throttling behavior so `/auth/me` probing no longer consumes login rate-limit capacity
- Fixed login IP handling to use trusted proxy aware request IPs instead of blindly trusting forwarded headers
- Fixed AI specific rate limiting by mounting the dedicated limiter on `/api/ai`
- Fixed Markdown emphasis parsing so `* ` bullet lists no longer lose list semantics during rendering

## [1.0.0] - 2026-03-12

### Added

- Initial public-ready release of Tech Growth Hub
- Question management, learning modes, bookmarks, AI assistant, AI generation, AI polishing
- User management, permission management, database management, backup and restore
