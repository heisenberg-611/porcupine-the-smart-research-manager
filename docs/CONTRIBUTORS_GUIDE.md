# Contributor Data Guide (`contributors.json`)

This guide explains how to add, edit, or manage contributor and advisor profiles displayed on the **Feedback & Contributions** page (`/feedback-and-contributions`) and the landing page.

---

## 📁 File Location

Contributor records are stored in:
```
apps/web/src/data/contributors.json
```

Associated types, styling tokens, and helper functions are defined in:
```
apps/web/src/lib/contributors.ts
```

---

## ⚠️ Important JSON Syntax Rules

1. **No Comments Allowed**: Standard JSON does **not** permit comments (`//` or `/* ... */`). Do not add comment blocks to `contributors.json`.
2. **Trailing Commas**: JSON does not permit trailing commas after the last item in an array or object.
3. **Double Quotes**: All keys and string values must use standard double quotes (`"`).

---

## 📋 Schema Definition

Each entry in `contributors.json` is an object in the JSON array adhering to the `Contributor` TypeScript interface:

```typescript
export interface Contributor {
  id: string;              // Unique identifier (e.g., "1", "2")
  name: string;            // Contributor's full name
  role: string;            // Title, affiliation, or professional role
  avatar?: string;         // (Optional) Direct URL to image/photo
  link?: string;           // (Optional) URL to profile, website, or GitHub
  type: ContributionCategory; // Category of contribution (see below)
  badge: string;           // Badge title (see predefined badges below)
  contribution: string;    // Brief summary of what was contributed/advised
  date: string;            // Month and Year (e.g., "August 2026")
}
```

---

## 🏷️ Allowed Contribution Types (`type`)

The `type` field must match one of the following exact string values:

| Type | Description & Primary Use Case |
| :--- | :--- |
| `"Feedback"` | User testing feedback, usability improvements, and workflows |
| `"Feature Suggestion"` | Ideated new features, architectural ideas, or pipelines |
| `"Code"` | Code contributions, pull requests, refactoring, bug fixes |
| `"Design"` | UI/UX mockups, graphics, themes, layout suggestions |
| `"Research"` | Methodology, PRISMA adherence, systematic review practices |
| `"Documentation"` | Documentation, user guides, tutorials, setup instructions |

---

## 🎖️ Predefined Badges (`badge`)

Copy and paste any of these predefined badges into the `badge` field. They are pre-configured with custom color themes in `apps/web/src/lib/contributors.ts`:

| Badge Name | Purpose / Focus Area |
| :--- | :--- |
| `🌟 Core Advisor` | Domain, academic, & strategic guidance |
| `💡 Feature Architect` | Ideating new features or workflow systems |
| `🔍 UX & Usability Hero` | Feedback on UI, keyboard navigation, & usability |
| `⚡ Performance Champion` | Speed, caching, queries, & export optimizations |
| `🛡️ Security & Privacy Guard` | Cryptography, E2EE, device keys, & security reviews |
| `🧪 Bug Hunter & QA` | Identifying edge cases, stress testing, & reporting bugs |
| `📚 Review Methodology Pioneer` | PRISMA, Cochrane, & literature review compliance |
| `🚀 Early Adopter` | Beta testing & early adoption feedback |
| `🤝 Community Champion` | Mentoring, advocacy, community outreach, & adoption |
| `📝 Docs & Guides Contributor` | Guides, tutorials, & documentation contributions |

> [!NOTE]
> Custom badges can also be used as text; if a badge does not match one of the presets above, the UI will fall back to a clean neutral badge style.

---

## 📝 Example `contributors.json`

```json
[
  {
    "id": "1",
    "name": "Dr. Muhammad Iqbal Hossain",
    "role": "Associate Professor · BRAC University",
    "avatar": "https://cse.bracu.ac.bd/storage/media/945/Iqbal_CSE-2.png",
    "link": "https://cse.bracu.ac.bd/faculty_profile/24/dr_muhammad_iqbal_hossain",
    "type": "Feedback",
    "badge": "🌟 Core Advisor",
    "contribution": "Advised to add the workflow pipeline and to make the workflow simple for the end user.",
    "date": "August 2026"
  },
  {
    "id": "2",
    "name": "Jane Doe",
    "role": "PhD Candidate · Stanford University",
    "avatar": "https://example.com/avatar.png",
    "link": "https://github.com/janedoe",
    "type": "Code",
    "badge": "⚡ Performance Champion",
    "contribution": "Optimized RIS and BibTeX parser throughput for large 10k+ reference files.",
    "date": "August 2026"
  }
]
```

---

## ✅ How to Verify Your Changes

After editing `contributors.json`, verify that the data passes type checking and builds cleanly:

```bash
# In apps/web
npm run typecheck

# Or from monorepo root
pnpm --filter @Porcupine/web typecheck
```
