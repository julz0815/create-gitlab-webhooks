# GitLab Webhook Creator

This script creates webhooks for multiple GitLab repositories based on a list of repositories in a text file.

## Prerequisites

- Node.js 18 or higher
- GitLab Personal Access Token (PAT) with appropriate permissions
- List of repositories in a text file

## Setup

1. Create a `repos.txt` file with your repositories in the format:
   ```
   group/repo
   group/subgroup/repo
   group/subgroup1/subgroup2/repo
   group/*  # Creates webhooks for all repositories in the group and its subgroups
   group/subgroup1/* # Creates webhooks for all repositories in the subgroup and its subgroups
   ```

## Usage

### Local Usage

1. Set the required environment variables:
   ```bash
   export GITLAB_PAT="your-personal-access-token"
   export WEBHOOK_URL="your-webhook-url"
   export GITLAB_URL="your-gitlab-url" # Optional, defaults to https://gitlab.com
   export REPOS_FILE="path-to-repos.txt" # Optional, defaults to repos.txt
   ```

2. Run the script:
   ```bash
   node dist/create-webhooks.js
   ```

### GitLab CI Usage

The script can be run in a GitLab CI pipeline. The pipeline is configured to run when triggered manually from the web interface.

Required CI/CD variables:
- `GITLAB_PAT`: Your GitLab Personal Access Token
- `WEBHOOK_URL`: The URL where webhooks should be sent
If you are not on gitlab.com but use your own domain please also add this variable
- `GITLAB_URL`: The URL for your GitLab installaion

Example gitlab-ci.yml:
```
image: node:18

create-webhooks:
  stage: deploy
  script:
    - node create-webhooks.js
  only:
    - main
```

## Configuration

The script creates webhooks with the following events enabled:
- Push events
- Merge request events
- Issues events

The webhook token is set to a static value defined in the script (`secret-token`). You can modify this in the source code if needed.

## Error Handling

The script will:
- Validate required environment variables
- Log success/failure for each repository
- Exit with status code 1 if any errors occur

## Compilation

If you want to compile the script yourself, use:
```bash
ncc build src/create-webhooks.ts && mv dist/index.js dist/create-webhooks.js
```

This will create `create-webhooks.js` in the dist folder. 