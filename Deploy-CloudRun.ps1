param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectId,
    [string]$Region = "us-central1",
    [string]$ServiceName = "memory-lens",
    [string]$OpenAiSecret = "memory-lens-openai-key",
    [string]$YouTubeSecret = "",
    [string]$SerperSecret = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    throw "Google Cloud CLI is required. Install it from https://cloud.google.com/sdk/docs/install and run 'gcloud auth login'."
}

gcloud config set project $ProjectId
if ($LASTEXITCODE -ne 0) { throw "Could not select Google Cloud project '$ProjectId'." }

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
if ($LASTEXITCODE -ne 0) { throw "Could not enable the required Google Cloud APIs." }

$arguments = @(
    "run", "deploy", $ServiceName,
    "--source", ".",
    "--project", $ProjectId,
    "--region", $Region,
    "--allow-unauthenticated",
    "--port", "8080",
    "--memory", "512Mi",
    "--cpu", "1",
    "--min-instances", "0",
    "--max-instances", "3",
    "--set-env-vars", "NODE_ENV=production"
)

$secrets = @()
if ($OpenAiSecret) { $secrets += "OPENAI_API_KEY=$OpenAiSecret`:latest" }
if ($YouTubeSecret) { $secrets += "YOUTUBE_API_KEY=$YouTubeSecret`:latest" }
if ($SerperSecret) { $secrets += "SERPER_API_KEY=$SerperSecret`:latest" }
if ($secrets.Count) { $arguments += @("--set-secrets", ($secrets -join ",")) }

& gcloud @arguments
if ($LASTEXITCODE -ne 0) { throw "Cloud Run deployment failed." }

gcloud run services describe $ServiceName --project $ProjectId --region $Region --format "value(status.url)"
