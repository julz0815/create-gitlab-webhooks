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
    requestTimeout: 30000
});

// Helper function to log API calls
async function logApiCall<T>(
    operation: string,
    apiCall: () => Promise<T>,
    requestDetails?: any
): Promise<T> {
    console.log(`\n=== API Call: ${operation} ===`);
    if (requestDetails) {
        console.log('Request Details:', JSON.stringify(requestDetails, null, 2));
    }
    try {
        const result = await apiCall();
        console.log('Response:', JSON.stringify(result, null, 2));
        console.log(`=== End API Call: ${operation} ===\n`);
        return result;
    } catch (error: any) {
        console.error(`=== Error in API Call: ${operation} ===`);
        if (error.response) {
            console.error('Error Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
            });
        }
        console.error('Error:', error);
        console.error(`=== End Error in API Call: ${operation} ===\n`);
        throw error;
    }
}

async function createWebhook(groupPath: string, repoName: string) {
    try {
        // Construct the full project path
        const projectPath = `${groupPath}/${repoName}`;
        
        console.log(`\n=== Webhook Operations for ${projectPath} ===`);
        console.log(`API Base URL: ${GITLAB_URL}`);
        
        // Get existing webhooks
        console.log(`\nFetching existing webhooks...`);
        const existingWebhooks = await logApiCall(
            'Get Project Hooks',
            () => api.ProjectHooks.all(projectPath),
            { projectPath }
        ) as Webhook[];
        
        console.log(`Found ${existingWebhooks.length} existing webhooks`);
        
        // Check if webhook with our URL already exists
        const existingWebhook = existingWebhooks.find((hook: Webhook) => hook.url === encodedWebhookUrl);
        
        console.log(`\nWebhook URL being used: ${encodedWebhookUrl}`);
        console.log(`Existing webhooks: ${JSON.stringify(existingWebhooks, null, 2)}`);
        
        let webhook;
        if (existingWebhook) {
            // Delete existing webhook
            console.log(`\nDeleting existing webhook...`);
            await logApiCall(
                'Delete Project Hook',
                () => api.ProjectHooks.remove(projectPath, existingWebhook.id),
                { projectPath, hookId: existingWebhook.id }
            );
            console.log(`Deleted existing webhook for ${projectPath}`);
        }
        
        // Create new webhook
        console.log(`\nCreating new webhook...`);
        const webhookConfig = {
            url: encodedWebhookUrl,
            push_events: true,
            merge_requests_events: true,
            issues_events: true,
            enable_ssl_verification: true,
            token: MASKED_WEBHOOK_PART
        };
        
        webhook = await logApiCall(
            'Create Project Hook',
            () => api.ProjectHooks.add(projectPath, encodedWebhookUrl, webhookConfig),
            { projectPath, webhookConfig }
        );
        
        console.log(`Created new webhook for ${projectPath}`);
        console.log(`=== End Webhook Operations for ${projectPath} ===\n`);

        return webhook;
    } catch (error: any) {
        console.error(`\n=== Error in Webhook Operations for ${groupPath}/${repoName} ===`);
        if (error.response) {
            console.error('Error Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
            });
        }
        console.error(`Error details:`, error);
        console.error(`=== End Error Details ===\n`);
        throw error;
    }
}

async function getAllGroupRepositories(groupPath: string): Promise<{ groupPath: string; repoName: string }[]> {
    try {
        console.log(`\n=== Getting Repositories for Group ${groupPath} ===`);
        console.log(`API Base URL: ${GITLAB_URL}`);
        
        // Get all projects in the group and subgroups
        console.log(`\nFetching projects...`);
        const projects = await logApiCall(
            'Get Group Projects',
            () => api.Groups.projects(groupPath, {
                include_subgroups: true,
                per_page: 100
            }),
            { groupPath, include_subgroups: true, per_page: 100 }
        ) as Project[];
        
        console.log(`Found ${projects.length} projects`);
        console.log(`Projects: ${JSON.stringify(projects.map(p => p.path_with_namespace), null, 2)}`);

        const repositories = projects.map((project: Project) => {
            // Extract group path and repo name from the full path
            const fullPath = project.path_with_namespace;
            const parts = fullPath.split('/');
            const repoName = parts.pop()!;
            const groupPath = parts.join('/');
            return { groupPath, repoName };
        });

        console.log(`\nProcessed repositories: ${JSON.stringify(repositories, null, 2)}`);
        console.log(`=== End Group Repositories for ${groupPath} ===\n`);

        return repositories;
    } catch (error: any) {
        console.error(`\n=== Error Getting Repositories for Group ${groupPath} ===`);
        if (error.response) {
            console.error('Error Response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data,
                headers: error.response.headers
            });
        }
        console.error(`Error details:`, error);
        console.error(`=== End Error Details ===\n`);
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

            console.log("\nGitLab URL:" + GITLAB_URL);
            console.log("\nPersonal Access Token:" + PAT);
            console.log("\nWebhook URL:" + WEBHOOK_URL);
            console.log("\nRepositories file:" + REPOS_FILE);
            
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