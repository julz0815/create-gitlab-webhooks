import { Gitlab } from 'gitlab';
import * as fs from 'fs';
import * as path from 'path';

// Define webhook interface
interface Webhook {
    id: number;
    url: string;
    name?: string;
    description?: string;
    push_events: boolean;
    merge_requests_events: boolean;
    issues_events: boolean;
    enable_ssl_verification: boolean;
    tag_push_events: boolean;
    pipeline_events: boolean;
    wiki_page_events: boolean;
    deployment_events: boolean;
    feature_flag_events: boolean;
    job_events: boolean;
    releases_events: boolean;
    emoji_events: boolean;
    resource_access_token_events: boolean;
    vulnerability_events: boolean;
    created_at?: string;
    project_id?: number;
    alert_status?: string;
    disabled_until?: string | null;
    push_events_branch_filter?: string | null;
    branch_filter_strategy?: string;
    custom_webhook_template?: string | null;
    confidential_issues_events?: boolean;
    note_events?: boolean;
    confidential_note_events?: boolean | null;
    repository_update_events?: boolean;
}

// Define project interface
interface Project {
    id: number;
    path_with_namespace: string;
    name: string;
    path: string;
}

// Configuration
const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';
const PAT = process.env.GITLAB_PAT;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const REPOS_FILE = process.env.REPOS_FILE || 'repos.txt';

// Static part of the webhook URL that should be masked
const MASKED_WEBHOOK_PART = 'secret-token';

if (!PAT) {
    console.error('*** GitLab Personal Access Token (PAT) is required');
    process.exit(1);
}

if (!WEBHOOK_URL) {
    console.error('*** Webhook URL is required ***');
    process.exit(1);
}

// Validate and encode URL
let encodedWebhookUrl: string;
try {
    // Parse the URL to validate it
    const url = new URL(WEBHOOK_URL);
    // Keep the URL exactly as provided, just validate it's a proper URL
    encodedWebhookUrl = WEBHOOK_URL;
} catch (error) {
    console.error('*** Invalid webhook URL format. Please provide a valid URL including protocol (http:// or https://) ***');
    process.exit(1);
}

const api = new Gitlab({
    host: GITLAB_URL,
    token: PAT,
});

async function createWebhook(groupPath: string, repoName: string) {
    try {
        // Construct the full project path
        const projectPath = `${groupPath}/${repoName}`;
        
        // Get existing webhooks
        const existingWebhooks = await api.ProjectHooks.all(projectPath) as Webhook[];
        
        // Check if webhook with our URL already exists
        const existingWebhook = existingWebhooks.find((hook: Webhook) => hook.url === encodedWebhookUrl);
        
        
        let webhook;
        if (existingWebhook) {
            // Delete existing webhook
            await api.ProjectHooks.remove(projectPath, existingWebhook.id);
            console.log(`-- Deleted existing webhook for ${projectPath}`);
        }
        
        // Create new webhook
        webhook = await api.ProjectHooks.add(projectPath, encodedWebhookUrl, {
            push_events: true,
            merge_requests_events: true,
            issues_events: true,
            enable_ssl_verification: true,
            token: MASKED_WEBHOOK_PART
        });
        console.log(`-- Created new webhook for ${projectPath}`);

        return webhook;
    } catch (error) {
        console.error(`--Failed to create/update webhook for ${groupPath}/${repoName}:`, error);
        throw error;
    }
}

async function getAllGroupRepositories(groupPath: string): Promise<{ groupPath: string; repoName: string }[]> {
    try {
        // Get all projects in the group and subgroups
        const projects = await api.Groups.projects(groupPath, {
            include_subgroups: true,
            per_page: 100
        }) as Project[];

        return projects.map((project: Project) => {
            // Extract group path and repo name from the full path
            const fullPath = project.path_with_namespace;
            const parts = fullPath.split('/');
            const repoName = parts.pop()!;
            const groupPath = parts.join('/');
            return { groupPath, repoName };
        });
    } catch (error) {
        console.error(`--Failed to get repositories for group ${groupPath}:`, error);
        throw error;
    }
}

async function processRepositories() {
    try {
        // Read the repositories file
        const content = fs.readFileSync(REPOS_FILE, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        for (const line of lines) {
            const parts = line.split('/');
            const repoName = parts.pop()!; // Get the last part (repository name)
            const groupPath = parts.join('/'); // Join the remaining parts as group path

            console.log(`\nProcessing repository: ${line}`);
            
            if (repoName === '*') {
                // Get all repositories in the group and subgroups
                const repositories = await getAllGroupRepositories(groupPath);
                console.log(`--Found ${repositories.length} repositories in group ${groupPath}`);
                
                // Create webhooks for all repositories
                for (const repo of repositories) {
                    await createWebhook(repo.groupPath, repo.repoName);
                }
            } else {
                // Create webhook for single repository
                await createWebhook(groupPath, repoName);
            }
        }

        console.log('\n\nAll webhooks have been created successfully');
    } catch (error) {
        console.error('\n\nError processing repositories:', error);
        process.exit(1);
    }
}

// Run the script
processRepositories(); 