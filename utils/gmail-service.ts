// Gmail API integration for reading and managing emails

export interface Email {
    id: string;
    from: string;
    subject: string;
    snippet: string;
    body: string;
    date: string;
    isUnread: boolean;
}

export class GmailService {
    private accessToken: string | null = null;

    setAccessToken(token: string) {
        this.accessToken = token;
    }

    async getUnreadEmails(maxResults: number = 10): Promise<Email[]> {
        if (!this.accessToken) {
            throw new Error('Not authenticated with Gmail');
        }

        try {
            // Get list of unread messages
            const listResponse = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=${maxResults}`,
                {
                    headers: {
                        Authorization: `Bearer ${this.accessToken}`,
                    },
                }
            );

            const listData = await listResponse.json();

            if (!listData.messages) {
                return [];
            }

            // Fetch full details for each message
            const emails: Email[] = [];
            for (const message of listData.messages) {
                const detailResponse = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
                    {
                        headers: {
                            Authorization: `Bearer ${this.accessToken}`,
                        },
                    }
                );

                const detail = await detailResponse.json();
                emails.push(this.parseEmail(detail));
            }

            return emails;
        } catch (error) {
            console.error('Error fetching emails:', error);
            throw error;
        }
    }

    async searchEmails(query: string, maxResults: number = 10): Promise<Email[]> {
        if (!this.accessToken) {
            throw new Error('Not authenticated with Gmail');
        }

        try {
            const listResponse = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
                {
                    headers: {
                        Authorization: `Bearer ${this.accessToken}`,
                    },
                }
            );

            const listData = await listResponse.json();

            if (!listData.messages) {
                return [];
            }

            const emails: Email[] = [];
            for (const message of listData.messages) {
                const detailResponse = await fetch(
                    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}`,
                    {
                        headers: {
                            Authorization: `Bearer ${this.accessToken}`,
                        },
                    }
                );

                const detail = await detailResponse.json();
                emails.push(this.parseEmail(detail));
            }

            return emails;
        } catch (error) {
            console.error('Error searching emails:', error);
            throw error;
        }
    }

    private parseEmail(message: any): Email {
        const headers = message.payload.headers;
        const getHeader = (name: string) => {
            const header = headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase());
            return header ? header.value : '';
        };

        // Extract body
        let body = '';
        if (message.payload.body.data) {
            body = atob(message.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
        } else if (message.payload.parts) {
            const textPart = message.payload.parts.find((part: any) => part.mimeType === 'text/plain');
            if (textPart && textPart.body.data) {
                body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
            }
        }

        return {
            id: message.id,
            from: getHeader('From'),
            subject: getHeader('Subject'),
            snippet: message.snippet,
            body: body.substring(0, 500), // Limit body length
            date: getHeader('Date'),
            isUnread: message.labelIds?.includes('UNREAD') || false,
        };
    }

    async summarizeEmails(emails: Email[]): Promise<string> {
        if (emails.length === 0) {
            return 'You have no unread emails.';
        }

        const summary = emails.map((email, index) => {
            const from = email.from.replace(/<.*>/, '').trim();
            return `${index + 1}. From ${from}: ${email.subject}`;
        }).join('\n');

        return `You have ${emails.length} unread email${emails.length > 1 ? 's' : ''}:\n${summary}`;
    }
}

export const gmailService = new GmailService();
