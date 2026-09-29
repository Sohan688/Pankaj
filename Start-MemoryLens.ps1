param(
    [int]$Port = 4173
)

$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot "public"
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

function Write-JsonResponse {
    param($Response, [int]$Status, $Body)
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 12 -Compress))
    Set-SecurityHeaders $Response
    $Response.StatusCode = $Status
    $Response.ContentType = "application/json; charset=utf-8"
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

function Set-SecurityHeaders {
    param($Response)
    $Response.Headers["Content-Security-Policy"] = "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'"
    $Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    $Response.Headers["X-Content-Type-Options"] = "nosniff"
    $Response.Headers["X-Frame-Options"] = "SAMEORIGIN"
    $Response.Headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
}

function Invoke-AiAnalysis {
    param($Items)
    if (-not $env:OPENAI_API_KEY) {
        throw "AI analysis is not configured. Set OPENAI_API_KEY or use the included demo analysis."
    }

    $systemPrompt = @"
You are a product research analyst. Analyze each user quote about finding old photos.
Return JSON: {"items":[{"id":"input id","memoryCues":["people|place|event|time|object|visual|emotion|context"],"forgotten":["date|location|album|keywords|person|source"],"failureMode":"one concise label","intent":"photo type or goal","queryPattern":"how the user tries to search","severity":1-5,"confidence":0-1,"rationale":"one sentence"}]}.
Use only evidence in the quote. Do not invent demographics or facts.
"@
    $payload = @{
        model = if ($env:OPENAI_MODEL) { $env:OPENAI_MODEL } else { "gpt-4o-mini" }
        response_format = @{ type = "json_object" }
        temperature = 0.1
        messages = @(
            @{ role = "system"; content = $systemPrompt }
            @{ role = "user"; content = ($Items | ConvertTo-Json -Depth 8 -Compress) }
        )
    } | ConvertTo-Json -Depth 10

    $headers = @{ Authorization = "Bearer $env:OPENAI_API_KEY" }
    $result = Invoke-RestMethod -Uri "https://api.openai.com/v1/chat/completions" -Method Post -Headers $headers -ContentType "application/json" -Body $payload
    return ($result.choices[0].message.content | ConvertFrom-Json).items
}

function Test-DateRange {
    param([string]$Date, [string]$StartDate, [string]$EndDate)
    $value = [datetime]::Parse($Date).Date
    return $value -ge [datetime]::Parse($StartDate).Date -and $value -le [datetime]::Parse($EndDate).Date
}

function Get-RedditFeedback {
    param([string]$Query, [string]$StartDate, [string]$EndDate)
    $encoded = [uri]::EscapeDataString($Query)
    $result = Invoke-RestMethod -Uri "https://www.reddit.com/r/googlephotos/search.json?q=$encoded&restrict_sr=on&sort=new&t=all&limit=100" -Headers @{ "User-Agent" = "MemoryLensResearch/1.0" }
    $items = @()
    foreach ($child in $result.data.children) {
        $post = $child.data
        $date = [DateTimeOffset]::FromUnixTimeSeconds([long]$post.created_utc).UtcDateTime.ToString("yyyy-MM-dd")
        if (Test-DateRange $date $StartDate $EndDate) {
            $text = (@($post.title, $post.selftext) | Where-Object { $_ }) -join " - "
            if ($text) {
                $items += @{ id = "reddit-$($post.id)"; source = "Reddit"; date = $date; text = $text.Substring(0, [Math]::Min(3000, $text.Length)); url = "https://www.reddit.com$($post.permalink)" }
            }
        }
    }
    return $items
}

function Get-AppStoreFeedback {
    param([string]$StartDate, [string]$EndDate)
    $result = Invoke-RestMethod -Uri "https://itunes.apple.com/rss/customerreviews/page=1/id=962194608/sortby=mostrecent/json"
    $items = @()
    foreach ($entry in $result.feed.entry) {
        if (-not $entry.'im:rating') { continue }
        $date = ([string]$entry.updated.label).Substring(0, 10)
        if (Test-DateRange $date $StartDate $EndDate) {
            $text = "$($entry.title.label) - $($entry.content.label)"
            $reviewId = ([string]$entry.id.label).Split("/")[-1]
            $items += @{ id = "appstore-$reviewId"; source = "App Store"; date = $date; text = $text.Substring(0, [Math]::Min(3000, $text.Length)); url = "https://apps.apple.com/app/google-photos/id962194608" }
        }
    }
    return $items
}

function Get-YouTubeFeedback {
    param([string]$Query, [string]$StartDate, [string]$EndDate)
    if (-not $env:YOUTUBE_API_KEY) { throw "YOUTUBE_API_KEY not configured" }
    $encoded = [uri]::EscapeDataString("Google Photos $Query")
    $searchUrl = "https://www.googleapis.com/youtube/v3/search?key=$($env:YOUTUBE_API_KEY)&part=snippet&type=video&maxResults=5&order=date&q=$encoded&publishedAfter=$($StartDate)T00%3A00%3A00Z&publishedBefore=$($EndDate)T23%3A59%3A59Z"
    $videos = Invoke-RestMethod -Uri $searchUrl
    $items = @()
    foreach ($video in $videos.items) {
        $commentsUrl = "https://www.googleapis.com/youtube/v3/commentThreads?key=$($env:YOUTUBE_API_KEY)&part=snippet&videoId=$($video.id.videoId)&maxResults=20&order=time&textFormat=plainText"
        try { $comments = Invoke-RestMethod -Uri $commentsUrl } catch { continue }
        foreach ($thread in $comments.items) {
            $comment = $thread.snippet.topLevelComment.snippet
            $date = ([string]$comment.publishedAt).Substring(0, 10)
            if (Test-DateRange $date $StartDate $EndDate) {
                $text = [string]$comment.textDisplay
                $items += @{ id = "youtube-$($thread.id)"; source = "YouTube"; date = $date; text = $text.Substring(0, [Math]::Min(3000, $text.Length)); url = "https://www.youtube.com/watch?v=$($video.id.videoId)&lc=$($thread.id)" }
            }
        }
    }
    return $items
}

function Get-WebFeedback {
    param([string]$Query, [string]$StartDate, [string]$EndDate)
    if (-not $env:SERPER_API_KEY) { throw "SERPER_API_KEY not configured" }
    $sites = "(site:support.google.com/photos OR site:play.google.com OR site:x.com OR site:facebook.com OR site:quora.com)"
    $start = ([datetime]::Parse($StartDate)).ToString("MM/dd/yyyy")
    $end = ([datetime]::Parse($EndDate)).ToString("MM/dd/yyyy")
    $payload = @{ q = "$Query Google Photos $sites"; num = 30; tbs = "cdr:1,cd_min:$start,cd_max:$end" } | ConvertTo-Json
    $result = Invoke-RestMethod -Uri "https://google.serper.dev/search" -Method Post -Headers @{ "X-API-KEY" = $env:SERPER_API_KEY } -ContentType "application/json" -Body $payload
    $items = @()
    $index = 0
    foreach ($entry in $result.organic) {
        $parsedDate = [datetime]::MinValue
        if (-not $entry.date -or -not [datetime]::TryParse([string]$entry.date, [ref]$parsedDate) -or -not (Test-DateRange $parsedDate.ToString("yyyy-MM-dd") $StartDate $EndDate)) { continue }
        $hostName = ([uri]$entry.link).Host
        $source = if ($hostName -like "*support.google.com*") { "Google Photos Community" } elseif ($hostName -like "*play.google.com*") { "Play Store" } elseif ($hostName -like "*x.com*") { "Social media" } else { "Forum" }
        $text = "$($entry.title) - $($entry.snippet)"
        $items += @{ id = "web-$index-$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"; source = $source; date = $parsedDate.ToString("yyyy-MM-dd"); text = $text.Substring(0, [Math]::Min(3000, $text.Length)); url = [string]$entry.link }
        $index++
    }
    return $items
}

function Invoke-AiSummary {
    param($Items, $Analysis, [string]$StartDate, [string]$EndDate)
    $systemPrompt = 'Synthesize photo-retrieval research without inventing evidence. Return JSON: {"headline":"concise insight","summary":"2-3 sentence executive summary","findings":[{"title":"finding","evidence":"specific pattern with count","implication":"product implication"}],"opportunity":"highest-leverage opportunity","limitations":["coverage caveat"]}. Distinguish prevalence in this sample from population prevalence.'
    $payload = @{
        model = if ($env:OPENAI_MODEL) { $env:OPENAI_MODEL } else { "gpt-4o-mini" }
        response_format = @{ type = "json_object" }
        temperature = 0.2
        messages = @(
            @{ role = "system"; content = $systemPrompt }
            @{ role = "user"; content = (@{ period = @{ startDate = $StartDate; endDate = $EndDate }; feedback = $Items; coding = $Analysis } | ConvertTo-Json -Depth 12 -Compress) }
        )
    } | ConvertTo-Json -Depth 15
    $result = Invoke-RestMethod -Uri "https://api.openai.com/v1/chat/completions" -Method Post -Headers @{ Authorization = "Bearer $env:OPENAI_API_KEY" } -ContentType "application/json" -Body $payload
    return $result.choices[0].message.content | ConvertFrom-Json
}

function Invoke-ResearchRun {
    param([string]$Query, [string]$StartDate, [string]$EndDate)
    $allItems = @()
    $connectors = @()
    $sources = @(
        @{ name = "Reddit"; run = { Get-RedditFeedback $Query $StartDate $EndDate } },
        @{ name = "App Store"; run = { Get-AppStoreFeedback $StartDate $EndDate } },
        @{ name = "YouTube"; run = { Get-YouTubeFeedback $Query $StartDate $EndDate } },
        @{ name = "Web sources"; run = { Get-WebFeedback $Query $StartDate $EndDate } }
    )
    foreach ($source in $sources) {
        try {
            $items = @(& $source.run)
            $allItems += $items
            $connectors += @{ name = $source.name; status = "connected"; count = $items.Count }
        }
        catch {
            $connectors += @{ name = $source.name; status = "unavailable"; count = 0; error = $_.Exception.Message }
        }
    }
    $allItems = @($allItems | Select-Object -First 50)
    if (-not $allItems.Count) { return @{ items = @(); connectors = $connectors; analysis = @(); summary = $null } }
    if (-not $env:OPENAI_API_KEY) {
        return @{ items = $allItems; connectors = $connectors; analysis = @(); summary = $null; aiError = "OPENAI_API_KEY is not configured; collection completed without AI synthesis." }
    }
    $analysis = @(Invoke-AiAnalysis $allItems)
    $summary = Invoke-AiSummary $allItems $analysis $StartDate $EndDate
    return @{ items = $allItems; connectors = $connectors; analysis = $analysis; summary = $summary }
}

$contentTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css" = "text/css; charset=utf-8"
    ".js" = "text/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".svg" = "image/svg+xml"
}

try {
    $listener.Start()
    Write-Host "Memory Lens is running at http://127.0.0.1:$Port"
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            if ($request.HttpMethod -eq "GET" -and $request.Url.AbsolutePath -eq "/healthz") {
                Write-JsonResponse $response 200 @{ status = "ok" }
                continue
            }
            if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/api/research") {
                $reader = [IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                if (-not $body.startDate -or -not $body.endDate -or $body.startDate -gt $body.endDate) {
                    Write-JsonResponse $response 400 @{ error = "Provide a valid start and end date." }
                    continue
                }
                $query = if ($body.query) { [string]$body.query } else { "find old photo" }
                Write-JsonResponse $response 200 (Invoke-ResearchRun $query $body.startDate $body.endDate)
                continue
            }
            if ($request.HttpMethod -eq "POST" -and $request.Url.AbsolutePath -eq "/api/analyze") {
                $reader = [IO.StreamReader]::new($request.InputStream, $request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                if (-not $body.items -or $body.items.Count -eq 0) {
                    Write-JsonResponse $response 400 @{ error = "Provide at least one feedback item." }
                    continue
                }
                if (-not $env:OPENAI_API_KEY) {
                    Write-JsonResponse $response 503 @{ error = "AI analysis is not configured. Set OPENAI_API_KEY or use the included demo analysis." }
                    continue
                }
                $results = Invoke-AiAnalysis -Items @($body.items | Select-Object -First 50)
                Write-JsonResponse $response 200 @{ results = @($results) }
                continue
            }

            if ($request.HttpMethod -ne "GET") {
                Write-JsonResponse $response 405 @{ error = "Method not allowed" }
                continue
            }

            $relativePath = $request.Url.AbsolutePath.TrimStart("/")
            if (-not $relativePath) { $relativePath = "index.html" }
            $filePath = [IO.Path]::GetFullPath((Join-Path $root $relativePath))
            if (-not $filePath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $filePath -PathType Leaf)) {
                Write-JsonResponse $response 404 @{ error = "Not found" }
                continue
            }

            $bytes = [IO.File]::ReadAllBytes($filePath)
            $extension = [IO.Path]::GetExtension($filePath)
            $response.StatusCode = 200
            Set-SecurityHeaders $response
            $response.ContentType = if ($contentTypes[$extension]) { $contentTypes[$extension] } else { "application/octet-stream" }
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.Close()
        }
        catch {
            if ($response.OutputStream.CanWrite) {
                Write-JsonResponse $response 500 @{ error = $_.Exception.Message }
            }
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}
