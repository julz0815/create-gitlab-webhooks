import axios from 'axios';
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
    name: string;
    path_with_namespace: string;
}

// Configuration
const GITLAB_URL = process.env.GITLAB_URL || 'https://gitlab.com';
const PAT = process.env.GITLAB_PAT;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const REPOS_FILE = process.env.REPOS_FILE || 'repos.txt';
const DEBUG = process.argv.includes('--debug');

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

// Create Axios instance with default config
const api = axios.create({
    baseURL: `${GITLAB_URL}/api/v4`,
    headers: {
        'PRIVATE-TOKEN': PAT,
        'Content-Type': 'application/json'
    },
    timeout: 30000
});

async function getProjectId(projectPath: string): Promise<number> {
    try {
        if (DEBUG) {
            console.log(`Fetching project ID for ${projectPath}`);
        }
        const response = await api.get(`/projects/${encodeURIComponent(projectPath)}`);
        if (DEBUG) {
            console.log(response);
        }
        return (response.data as Project).id;
    } catch (error: any) {
        console.error(`Error fetching project ID for ${projectPath}:`, error);
        throw error;
    }
}

async function createWebhook(groupPath: string, repoName: string) {
    try {
        // Construct the full project path
        const projectPath = `${groupPath}/${repoName}`;
        
        console.log(`\nProcessing repository: ${projectPath}`);
        if (DEBUG) {
            console.log(`\n=== Webhook Operations for ${projectPath} ===`);
            console.log(`API Base URL: ${GITLAB_URL}`);
        }
        
        // Get project ID first
        const projectId = await getProjectId(projectPath);
        if (DEBUG) {
            console.log(`Project ID: ${projectId}`);
        }
        
        // Get existing webhooks
        if (DEBUG) {
            console.log(`\nFetching existing webhooks...`);
        }
        const response = await api.get(`/projects/${projectId}/hooks`);
        if (DEBUG) {
            console.log(response);
        }
        const existingWebhooks = response.data as Webhook[];
        
        if (DEBUG) {
            console.log(`Found ${existingWebhooks.length} existing webhooks`);
        }
        
        // Check if webhook with our URL already exists
        const existingWebhook = existingWebhooks.find((hook: Webhook) => hook.url === encodedWebhookUrl);
        
        if (DEBUG) {
            console.log(`\nWebhook URL being used: ${encodedWebhookUrl}`);
            console.log(`Existing webhooks:`, existingWebhooks);
        }
        
        let webhook;
        if (existingWebhook) {
            // Delete existing webhook
            console.log(`Found existing webhook - will be deleted`);
            if (DEBUG) {
                console.log(`\nDeleting existing webhook...`);
            }
            const deleteResponse = await api.delete(`/projects/${projectId}/hooks/${existingWebhook.id}`);
            if (DEBUG) {
                console.log(deleteResponse);
            }
            if (DEBUG) {
                console.log(`Deleted existing webhook for ${projectPath}`);
            }
        }
        
        // Create new webhook
        console.log(`Creating new webhook...`);
        if (DEBUG) {
            console.log(`\nCreating new webhook...`);
        }
        const webhookConfig = {
            url: encodedWebhookUrl,
            push_events: true,
            merge_requests_events: true,
            issues_events: true,
            enable_ssl_verification: true,
            token: MASKED_WEBHOOK_PART
        };
        
        const createResponse = await api.post(`/projects/${projectId}/hooks`, webhookConfig);
        if (DEBUG) {
            console.log(createResponse);
        }
        webhook = createResponse.data;
        
        console.log(`Webhook created successfully for ${projectPath}`);
        if (DEBUG) {
            console.log(`Created new webhook for ${projectPath}`);
            console.log(`=== End Webhook Operations for ${projectPath} ===\n`);
        }

        return webhook;
    } catch (error: any) {
        console.error(`\n=== Error in Webhook Operations for ${groupPath}/${repoName} ===`);
        if (DEBUG) {
            console.log(error);
        }
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
        console.log(`\nFetching repositories for group: ${groupPath}`);
        if (DEBUG) {
            console.log(`\n=== Getting Repositories for Group ${groupPath} ===`);
            console.log(`API Base URL: ${GITLAB_URL}`);
        }
        
        let allProjects: Project[] = [];
        let page = 1;
        const perPage = 100;
        
        // Get all projects in the group and subgroups with pagination
        if (DEBUG) {
            console.log(`\nFetching projects...`);
        }
        while (true) {
            const response = await api.get(`/groups/${encodeURIComponent(groupPath)}/projects`, {
                params: {
                    page,
                    per_page: perPage,
                    include_subgroups: true
                }
            });
            if (DEBUG) {
                console.log(response);
            }
            const projects = response.data as Project[];
            
            allProjects = allProjects.concat(projects);
            
            // If we got less than perPage items, we've reached the end
            if (projects.length < perPage) {
                break;
            }
            
            page++;
        }
        
        console.log(`Found ${allProjects.length} repositories to process`);
        if (DEBUG) {
            console.log(`Found ${allProjects.length} projects`);
            console.log(`Projects:`, allProjects.map(p => p.path_with_namespace));
        }

        const repositories = allProjects.map((project: Project) => {
            // Extract group path and repo name from the full path
            const fullPath = project.path_with_namespace;
            const parts = fullPath.split('/');
            const repoName = parts.pop()!;
            const groupPath = parts.join('/');
            return { groupPath, repoName };
        });

        if (DEBUG) {
            console.log(`\nProcessed repositories:`, repositories);
            console.log(`=== End Group Repositories for ${groupPath} ===\n`);
        }

        return repositories;
    } catch (error: any) {
        console.error(`\n=== Error Getting Repositories for Group ${groupPath} ===`);
        if (DEBUG) {
            console.log(error);
        }
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

        console.log(`\nStarting webhook creation process...`);
        console.log(`Reading repositories from: ${REPOS_FILE}`);
        console.log(`Found ${lines.length} entries to process`);

        for (const line of lines) {
            const parts = line.split('/');
            const repoName = parts.pop()!; // Get the last part (repository name)
            const groupPath = parts.join('/'); // Join the remaining parts as group path

            if (DEBUG) {
                console.log("\nGitLab URL:" + GITLAB_URL);
                console.log("\nPersonal Access Token:" + PAT);
                console.log("\nWebhook URL:" + WEBHOOK_URL);
                console.log("\nRepositories file:" + REPOS_FILE);
            }
            
            if (repoName === '*') {
                // Get all repositories in the group and subgroups
                const repositories = await getAllGroupRepositories(groupPath);
                console.log(`Processing ${repositories.length} repositories in group ${groupPath}`);
                
                // Create webhooks for all repositories
                for (const repo of repositories) {
                    await createWebhook(repo.groupPath, repo.repoName);
                }
            } else {
                // Create webhook for single repository
                await createWebhook(groupPath, repoName);
            }
        }

        console.log('\nAll webhooks have been created successfully');
    } catch (error) {
        console.error('\n\nError processing repositories:', error);
        process.exit(1);
    }
}

// Run the script
processRepositories(); 