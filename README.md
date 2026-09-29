# Memory Lens

Memory Lens is an AI-powered research workspace for finding and comparing breakdowns in old-photo retrieval. It focuses on how people remember—cues, uncertainty, intent, and search behavior—rather than generic sentiment.

## Run

On Windows, launch with the included zero-install PowerShell server:

```powershell
.\Start-MemoryLens.ps1
```

Open `http://127.0.0.1:4173`.

Alternatively, with Node.js 18 or newer, run `npm start`.

The app includes a representative demo dataset so the workflow is immediately explorable. To analyze newly pasted public feedback with an LLM:

```powershell
$env:OPENAI_API_KEY="your-key"
.\Start-MemoryLens.ps1
```

Set `OPENAI_MODEL` to override the default `gpt-4o-mini`.

For automated multi-platform research runs, configure the connectors you need:

```powershell
$env:OPENAI_API_KEY="..."  # AI coding and executive synthesis
$env:YOUTUBE_API_KEY="..." # Official YouTube Data API
$env:SERPER_API_KEY="..."  # Google support, Play Store, social, and forum discovery
.\Start-MemoryLens.ps1
```

Reddit and App Store use public endpoints without additional credentials. The app displays each connector's status and result count so missing credentials, API restrictions, and zero-result sources remain visible. It does not bypass authentication, scrape restricted pages, or claim complete platform coverage.

## Workflow

1. Collect public, attributable feedback from reviews, support communities, forums, and social discussions.
2. Extract remembered cues, forgotten details, query patterns, retrieval intent, failure mode, severity, and confidence.
3. Filter and compare evidence while retaining verbatim source language.
4. Prioritize opportunities by prevalence, user pain, and evidence confidence.

Only use publicly available content. Preserve source URLs in production ingestion, follow source terms, minimize personal data, and have researchers review AI-generated labels before decisions.

## Deploy publicly on Google Cloud Run

1. Install the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install), then run `gcloud auth login`.
2. Create the API-key secrets in Secret Manager:

   ```powershell
   "YOUR_OPENAI_KEY" | gcloud secrets create memory-lens-openai-key --data-file=-
   "YOUR_YOUTUBE_KEY" | gcloud secrets create memory-lens-youtube-key --data-file=-
   "YOUR_SERPER_KEY" | gcloud secrets create memory-lens-serper-key --data-file=-
   ```

3. Deploy from this directory:

   ```powershell
   .\Deploy-CloudRun.ps1 `
     -ProjectId "your-google-cloud-project" `
     -YouTubeSecret "memory-lens-youtube-key" `
     -SerperSecret "memory-lens-serper-key"
   ```

The deployment allows unauthenticated HTTPS access and prints the public URL. API keys remain server-side in Secret Manager. Before broad external use, add product authentication, quotas, durable storage, and a privacy review.

## Deploy with Vercel and GitHub

1. Push this folder to a GitHub repository.
2. In Vercel, select **Add New Project** and import the repository.
3. Keep the default build settings; `vercel.json` configures the static app and serverless API.
4. Add `OPENAI_API_KEY`, `YOUTUBE_API_KEY`, and `SERPER_API_KEY` under **Project Settings → Environment Variables**.
5. Deploy. Future pushes to the repository will create automatic Vercel deployments.

`OPENAI_API_KEY` is required for AI coding and synthesis. The other connector keys are optional; unavailable sources are reported in the interface.
