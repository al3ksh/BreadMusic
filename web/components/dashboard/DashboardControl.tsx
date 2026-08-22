'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { AtSign, Bold, Code2, Hash, Italic, MessageSquare, Mic, Paperclip, Terminal, X } from 'lucide-react';
import { useToast } from '@/components/ui/ToastProvider';
import { Section, Skeleton, Spinner } from '@/components/dashboard/DashboardPrimitives';

const inputClass = 'w-48 rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit]';
const selectClass = 'rounded-md border border-border bg-bg-input text-text-primary px-3 py-2 text-sm outline-none focus:border-accent transition-colors font-[inherit]';

export interface DiscordRole {
  id: string;
  name: string;
  color: string;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: number;
}

interface DiscordMember {
  id: string;
  username: string;
  displayName: string;
  avatar: string | null;
}

interface ChatMessage {
  id: string;
  content: string;
  author: {
    username: string;
    avatar: string | null;
    bot: boolean;
  };
  timestamp: number;
  attachments?: {
    url: string;
    name: string;
    contentType: string | null;
    width: number | null;
    height: number | null;
  }[];
  embeds?: {
    title: string | null;
    description: string | null;
    url: string | null;
    image: string | null;
    provider: string | null;
  }[];
  mentions?: {
    users?: { id: string; label: string }[];
    roles?: { id: string; label: string }[];
    channels?: { id: string; label: string }[];
  };
}

export function DashboardControl({ guildId }: { guildId: string }) {
  const toast = useToast();
  const [channels, setChannels] = useState<DiscordChannel[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [members, setMembers] = useState<DiscordMember[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [messageText, setMessageText] = useState('');
  const [memberMentionQuery, setMemberMentionQuery] = useState('');
  const [roleMentionQuery, setRoleMentionQuery] = useState('');
  const [attachment, setAttachment] = useState<{ name: string, base64: string } | null>(null);
  const [selectedTextId, setSelectedTextId] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState('');
  const [mentionConfirmOpen, setMentionConfirmOpen] = useState(false);
  const messageInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    Promise.allSettled([
      apiFetch<DiscordChannel[]>(`/guilds/${guildId}/channels`),
      apiFetch<DiscordRole[]>(`/guilds/${guildId}/roles`),
    ])
      .then(([channelsRes, rolesRes]) => {
        const channelList = channelsRes.status === 'fulfilled' ? channelsRes.value : [];
        setChannels(channelList);
        if (rolesRes.status === 'fulfilled') {
          setRoles((rolesRes.value || []).filter((role) => role.name !== '@everyone'));
        }
        if (channelList.length > 0) {
          const text = channelList.find(c => c.type === 0 || c.type === 5);
          const voice = channelList.find(c => c.type === 2 || c.type === 13);
          if (text) setSelectedTextId(text.id);
          if (voice) setSelectedVoiceId(voice.id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [guildId]);

  useEffect(() => {
    const query = memberMentionQuery.trim();
    if (query.length < 2) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      apiFetch<{ members: DiscordMember[] }>(`/guilds/${guildId}/members?q=${encodeURIComponent(query)}&limit=8`, {
        signal: controller.signal,
      })
        .then((res) => {
          if (!cancelled) setMembers(res.members || []);
        })
        .catch(() => {
          if (!cancelled && !controller.signal.aborted) setMembers([]);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [guildId, memberMentionQuery]);

  useEffect(() => {
    if (!selectedTextId) return;
    let stopped = false;
    let controller: AbortController | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;

    const fetchMsgs = () => {
      controller?.abort();
      controller = new AbortController();
      apiFetch<ChatMessage[]>(`/guilds/${guildId}/control/messages?channelId=${selectedTextId}`, {
        signal: controller.signal,
      })
        .then(res => { if (!stopped) setChatMessages(res); })
        .catch(() => {});
    };

    const stopPolling = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };
    const startPolling = () => {
      stopPolling();
      if (!document.hidden) interval = setInterval(fetchMsgs, 10_000);
    };

    fetchMsgs();
    startPolling();
    const handleVisibilityChange = () => {
      if (document.hidden) stopPolling();
      else {
        fetchMsgs();
        startPolling();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      stopped = true;
      stopPolling();
      controller?.abort();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [guildId, selectedTextId]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      toast.error('Attachment too large', 'Maximum upload size is 8MB.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      if (ev.target?.result && typeof ev.target.result === 'string') {
        setAttachment({
          name: file.name,
          base64: ev.target.result
        });
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const insertMessageSnippet = (before: string, after = '') => {
    const input = messageInputRef.current;
    const start = input?.selectionStart ?? messageText.length;
    const end = input?.selectionEnd ?? messageText.length;
    const selected = messageText.slice(start, end);
    const next = `${messageText.slice(0, start)}${before}${selected}${after}${messageText.slice(end)}`;
    setMessageText(next);
    requestAnimationFrame(() => {
      input?.focus();
      const cursor = selected
        ? start + before.length + selected.length + after.length
        : start + before.length;
      input?.setSelectionRange(cursor, cursor);
    });
  };

  const sendAction = async (action: 'say' | 'summon' | 'leave', options: { skipMentionConfirm?: boolean } = {}) => {
    setActioning(true);
    try {
      if (action === 'say') {
        if (!selectedTextId || (!messageText.trim() && !attachment)) return;
        if (!options.skipMentionConfirm && /(^|\s)@(everyone|here)(\s|$)/i.test(messageText)) {
          setMentionConfirmOpen(true);
          return;
        }
        await apiFetch(`/guilds/${guildId}/control/say`, {
          method: 'POST',
          body: JSON.stringify({
            channelId: selectedTextId,
            message: messageText,
            attachmentBase64: attachment?.base64,
            attachmentName: attachment?.name,
            allowedMentions: { users: true, roles: true, everyone: true },
          })
        });
        setMessageText('');
        setAttachment(null);
        setMentionConfirmOpen(false);
        toast.success('Message sent', 'Bot message was sent to the selected channel.');
      } else {
        await apiFetch(`/guilds/${guildId}/control/action`, {
          method: 'POST',
          body: JSON.stringify({ type: action, channelId: selectedVoiceId || undefined })
        });

        if (action === 'summon') {
          toast.success('Bot summoned', 'Bot joined the selected voice channel.');
        } else if (action === 'leave') {
          toast.success('Bot disconnected', 'Bot left the voice channel.');
        }
      }
    } catch (err) {
      console.error(err);
      const text = err instanceof Error ? err.message : 'Control action failed.';
      toast.error('Control action failed', text);
    } finally {
      setActioning(false);
    }
  };

  if (loading) return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <div className="bg-bg-card rounded-lg border border-border p-5">
        <Skeleton className="h-5 w-1/3 mb-4" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );

  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
  const voiceChannels = channels.filter(c => c.type === 2 || c.type === 13);
  const memberMentionResults = memberMentionQuery.trim()
    ? members
        .slice(0, 6)
    : [];
  const roleMentionResults = roleMentionQuery.trim()
    ? roles
        .filter((role) => role.name.toLowerCase().includes(roleMentionQuery.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  const renderMessageContent = (message: ChatMessage) => {
    if (!message.content) return null;
    const mentionLabels = new Map<string, string>();
    const mentions = message.mentions || {};
    (mentions.users || []).forEach((user) => mentionLabels.set(`<@${user.id}>`, `@${user.label}`));
    (mentions.users || []).forEach((user) => mentionLabels.set(`<@!${user.id}>`, `@${user.label}`));
    (mentions.roles || []).forEach((role) => mentionLabels.set(`<@&${role.id}>`, `@${role.label}`));
    (mentions.channels || []).forEach((channel) => mentionLabels.set(`<#${channel.id}>`, `#${channel.label}`));

    const pattern = /(<@!?\d+>|<@&\d+>|<#\d+>|https?:\/\/[^\s<]+)/g;
    return message.content.split(pattern).map((part, index) => {
      if (!part) return null;
      const mentionLabel = mentionLabels.get(part);
      if (mentionLabel) {
        return (
          <span key={index} className="inline-flex items-center rounded bg-accent/15 px-1 py-0.5 font-medium text-accent">
            {mentionLabel}
          </span>
        );
      }
      if (/^https?:\/\//i.test(part)) {
        return (
          <a key={index} href={part} target="_blank" rel="noreferrer" className="text-accent hover:underline break-all">
            {part}
          </a>
        );
      }
      return part;
    });
  };

  const isImageAttachment = (attachment: NonNullable<ChatMessage['attachments']>[number]) =>
    attachment.contentType?.startsWith('image/') || /\.(png|jpe?g|gif|webp)$/i.test(attachment.url);
  const isVideoAttachment = (attachment: NonNullable<ChatMessage['attachments']>[number]) =>
    attachment.contentType?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(attachment.url);

  return (
    <div className="grid grid-cols-1 gap-4 w-full max-w-6xl mx-auto lg:grid-cols-2 lg:items-stretch lg:gap-6">
      <div className="space-y-4 lg:space-y-6">
        <Section title="Send Message">
          <div className="flex min-h-0 flex-col gap-3 sm:gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Destination Channel</label>
            <select
              value={selectedTextId}
              onChange={(e) => setSelectedTextId(e.target.value)}
              className={selectClass + " w-full"}
            >
              {textChannels.map(c => <option key={c.id} value={c.id}>#{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Message Content</label>
            <div className="mb-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={() => insertMessageSnippet('**', '**')}
                title="Bold"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Bold size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('*', '*')}
                title="Italic"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Italic size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('`', '`')}
                title="Inline code"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Code2 size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('```\n', '\n```')}
                title="Code block"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                ```
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('||', '||')}
                title="Spoiler"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                ||
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('> ')}
                title="Quote"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                &gt;
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet(`<#${selectedTextId}>`)}
                title="Mention selected channel"
                className="p-2 rounded-md border border-border bg-bg-input text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer"
              >
                <Hash size={14} />
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('@everyone')}
                title="Mention everyone"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                @everyone
              </button>
              <button
                type="button"
                onClick={() => insertMessageSnippet('@here')}
                title="Mention online members"
                className="px-2 py-2 rounded-md border border-border bg-bg-input text-xs font-semibold text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors cursor-pointer sm:px-2.5"
              >
                @here
              </button>
            </div>
            <div className="mb-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                <div className="relative">
                  <AtSign size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={memberMentionQuery}
                    onChange={(e) => setMemberMentionQuery(e.target.value)}
                    placeholder="Search user to mention"
                    className="w-full rounded-md border border-border bg-bg-input text-text-primary pl-8 pr-3 py-2 text-xs outline-none focus:border-accent transition-colors placeholder:text-text-muted"
                  />
                </div>
                {memberMentionResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-bg-card shadow-xl overflow-hidden">
                    {memberMentionResults.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => {
                          insertMessageSnippet(`<@${member.id}>`);
                          setMemberMentionQuery('');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                      >
                        {member.avatar ? (
                          <img src={member.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                        ) : (
                          <span className="w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[10px]">{member.displayName.charAt(0).toUpperCase()}</span>
                        )}
                        <span className="truncate">{member.displayName}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <div className="relative">
                  <AtSign size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    value={roleMentionQuery}
                    onChange={(e) => setRoleMentionQuery(e.target.value)}
                    placeholder="Search role to mention"
                    className="w-full rounded-md border border-border bg-bg-input text-text-primary pl-8 pr-3 py-2 text-xs outline-none focus:border-accent transition-colors placeholder:text-text-muted"
                  />
                </div>
                {roleMentionResults.length > 0 && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-border bg-bg-card shadow-xl overflow-hidden">
                    {roleMentionResults.map((role) => (
                      <button
                        key={role.id}
                        type="button"
                        onClick={() => {
                          insertMessageSnippet(`<@&${role.id}>`);
                          setRoleMentionQuery('');
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                      >
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: role.color || '#6b7280' }} />
                        <span className="truncate">{role.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <textarea
              ref={messageInputRef}
              rows={4}
              value={messageText}
              onChange={e => setMessageText(e.target.value)}
              placeholder="Type a message for the bot to send..."
              className="max-h-44 min-h-24 w-full rounded-md border border-border bg-bg-input text-text-primary px-4 py-3 text-sm outline-none focus:border-accent transition-colors placeholder:text-text-muted font-[inherit] resize-y sm:max-h-48 sm:min-h-28"
            />
          </div>

          {attachment && (
            <div className="flex min-w-0 items-center gap-2 px-3 py-2 bg-accent/10 border border-accent/20 rounded-md text-sm text-text-primary">
              <span className="min-w-0 truncate flex-1 font-medium"><span className="text-accent">Attachment:</span> {attachment.name}</span>
              <button
                onClick={() => setAttachment(null)}
                className="shrink-0 hover:text-danger transition-colors cursor-pointer"
                type="button"
                title="Remove attachment"
              >
                <X size={16} />
              </button>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-3 pt-1">
            <button
              type="button"
              onClick={() => sendAction('say')}
              disabled={actioning || (!messageText.trim() && !attachment)}
              className="inline-flex min-w-0 items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-accent/20 sm:px-5"
            >
              <MessageSquare size={16} />
              {actioning ? 'Sending...' : 'Send as Bot'}
            </button>
            <label className="flex items-center justify-center px-4 py-2.5 rounded-lg bg-bg-input border border-border text-text-secondary hover:text-text-primary hover:border-accent transition-colors cursor-pointer group">
              <Paperclip size={16} className="group-hover:scale-110 transition-transform" />
              <input type="file" className="hidden" onChange={handleFileChange} accept="*/*" />
            </label>
          </div>
        </div>
      </Section>

      {mentionConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-bg-card shadow-2xl">
            <div className="border-b border-border bg-bg-secondary px-5 py-4">
              <h3 className="text-base font-semibold text-text-primary">Send server-wide mention?</h3>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm leading-relaxed text-text-secondary">
                This message contains <span className="font-semibold text-accent">@everyone</span> or <span className="font-semibold text-accent">@here</span>.
                It may notify many people in the selected channel.
              </p>
              <div className="rounded-md border border-border bg-bg-input px-3 py-2 text-xs text-text-muted">
                #{textChannels.find((channel) => channel.id === selectedTextId)?.name || 'selected channel'}
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-3 border-t border-border px-5 py-4">
              <button
                type="button"
                onClick={() => setMentionConfirmOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => sendAction('say', { skipMentionConfirm: true })}
                disabled={actioning}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-accent/20 transition-colors hover:bg-accent-hover disabled:opacity-50"
              >
                {actioning ? 'Sending...' : 'Send anyway'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Section title="Voice Connection">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Voice Channel</label>
            <select
              value={selectedVoiceId}
              onChange={(e) => setSelectedVoiceId(e.target.value)}
              className={selectClass + " w-full"}
            >
              {voiceChannels.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
             <button
              onClick={() => sendAction('summon')}
              disabled={actioning || !selectedVoiceId}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-hover transition-all shadow-lg shadow-accent/20 disabled:opacity-50 cursor-pointer sm:px-6"
            >
              <Mic size={16} />
              Summon Bot
            </button>
            <button
              onClick={() => sendAction('leave')}
              disabled={actioning}
              className="inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-danger/10 text-danger text-sm font-medium hover:bg-danger/20 transition-colors disabled:opacity-50 cursor-pointer sm:px-6"
            >
              Disconnect
            </button>
          </div>
        </div>
      </Section>
    </div>

      <div className="h-[420px] lg:h-[650px] flex flex-col bg-bg-card rounded-lg border border-border shadow-sm overflow-hidden">
        <div className="p-4 border-b border-border font-medium flex items-center gap-2">
           <MessageSquare size={16} className="text-accent" /> Live Chat
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col-reverse">
           {chatMessages.length === 0 ? <p className="text-text-muted text-sm text-center my-auto">No messages</p> : null}
           {chatMessages.map((m, i) => (
             <div key={m.id + i} className="flex gap-4">
               <img src={m.author.avatar || '/assets/breadicon.png'} className="w-9 h-9 rounded-full object-cover shrink-0 bg-black" />
               <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                  <span className={`text-[14px] font-semibold truncate ${m.author.bot ? 'text-accent' : 'text-text-primary'}`}>{m.author.username}</span>
                     {m.author.bot && <span className="px-1.5 py-0.5 rounded uppercase text-[10px] font-bold bg-accent/20 text-accent">BOT</span>}
                     <span className="text-xs text-text-muted shrink-0">{new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-[14px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words">{renderMessageContent(m)}</p>
                  {(m.attachments || []).length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {(m.attachments || []).map((a, j) => (
                        isImageAttachment(a) ? (
                          <img key={j} src={a.url} alt={a.name} className="max-h-48 max-w-full rounded-md object-contain border border-border bg-bg-body" />
                        ) : isVideoAttachment(a) ? (
                          <video key={j} src={a.url} controls className="max-h-48 max-w-full rounded-md border border-border bg-bg-body" />
                        ) : (
                          <a key={j} href={a.url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline break-all">
                            {a.name}
                          </a>
                        )
                      ))}
                    </div>
                  )}
                  {(m.embeds || []).length > 0 && (
                    <div className="space-y-2 mt-2">
                      {(m.embeds || []).map((embed, j) => (
                        <a
                          key={j}
                          href={embed.url || embed.image || undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="block max-w-sm rounded-md border border-border bg-bg-secondary/40 overflow-hidden hover:border-accent/40 transition-colors"
                        >
                          {embed.image && (
                            <img src={embed.image} alt="" className="max-h-56 w-full object-cover bg-bg-body" />
                          )}
                          {(embed.title || embed.description || embed.provider) && (
                            <div className="p-2.5">
                              {embed.provider && <p className="text-[10px] uppercase tracking-wide text-text-muted mb-1">{embed.provider}</p>}
                              {embed.title && <p className="text-sm font-medium text-text-primary line-clamp-2">{embed.title}</p>}
                              {embed.description && <p className="text-xs text-text-secondary mt-1 line-clamp-3">{embed.description}</p>}
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
               </div>
             </div>
           ))}
        </div>
      </div>
    </div>
  );
}
