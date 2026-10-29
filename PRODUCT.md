# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Learners and university students across multiple universities seeking peer-curated lecture notes, study guides, exam preparation cheat sheets, and course materials.

## Product Purpose

Democratize university study materials by providing an open, accessible academic knowledge hub where students can easily discover, download, and share high-quality course notes categorized by department and course. Success means students quickly finding reliable study materials and feeling motivated to contribute their own notes.

## Positioning

A collaborative student-to-student sharing hub that pairs open peer contributions with administrative quality moderation, structured departmental taxonomies, and a community "Rising Stars" contributor recognition system.

## Operating Context

Desktop and mobile web browser access during lecture study sessions, library prep, exam cramming, and group study. File uploads and downloads predominantly involving PDFs, DOCX, and slide documents.

## Capabilities and Constraints

- Department and course hierarchical catalog (e.g. CSE, EEE, BBA, MATH).
- Student authentication with email verification and role-based access control (Admin, User).
- Multi-file note uploads with moderation status lifecycle (pending, approved, rejected).
- Search, department filtering, and course-specific note repositories.
- "Rising Stars" contributor leaderboard ranking based on approved contribution scores.
- Technical stack: Express.js backend with session cookies, Supabase PostgreSQL with local mock fallback, and single-page application vanilla JavaScript / CSS frontend.

## Brand Commitments

- Product Name: University Notes Hub (short: Notes Hub).
- Incumbent dark theme palette with amber/gold accents (`#eab308`).
- Graduation cap and star iconography emphasizing academic achievement and contributor excellence.

## Evidence on Hand

- Production single-page frontend in `index.html` with department views, course notes lists, contributor modals, and upload forms.
- Express API in `server.js` with routes for auth, departments, courses, notes, and admin management.
- Database schema in `database.sql`.

## Product Principles

1. **Frictionless Discovery**: Finding relevant course notes should take seconds via intuitive departmental and course navigation.
2. **Community Trust through Moderation**: Ensure content quality and academic integrity with transparent review workflows.
3. **Rewarding Contribution**: Recognize active student contributors with transparent "Rising Stars" scoring and recognition.
4. **Resilient Simplicity**: Lean, fast-loading architecture that works reliably across varied devices and network conditions.

## Accessibility & Inclusion

- Responsive layout usable on mobile phones and laptops during classes and library study.
- High-contrast text readability in dark environments with accessible form inputs and touch targets.
