import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js'

const token = process.env.DISCORD_BOT_TOKEN?.trim()
const guildId = process.env.DISCORD_GUILD_ID?.trim()
const applicationId = process.env.DISCORD_APPLICATION_ID?.trim()
const allowedUsers = new Set(
    (process.env.DISCORD_ALLOWED_USER_IDS ?? '')
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
)
const apiToken = process.env.API_TOKEN?.trim()
const apiBase = `http://${process.env.API_HOST ?? '127.0.0.1'}:${process.env.API_PORT ?? '3010'}`
const apiHeaders = apiToken ? { Authorization: `Bearer ${apiToken}` } : {}

if (!token || !guildId || !applicationId || allowedUsers.size === 0) {
    throw new Error(
        'Discord bot requires DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, and DISCORD_ALLOWED_USER_IDS.'
    )
}

const commands = [
    new SlashCommandBuilder().setName('status').setDescription('Show bot status'),
    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('Show recent sanitized logs')
        .addIntegerOption(option =>
            option.setName('limit').setDescription('Number of lines (1-20)').setMinValue(1).setMaxValue(20)
        ),
    new SlashCommandBuilder().setName('accounts').setDescription('List configured account emails'),
    new SlashCommandBuilder()
        .setName('run')
        .setDescription('Start a rewards run')
        .addBooleanOption(option =>
            option.setName('confirm').setDescription('Confirm starting a run').setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName('schedule')
        .setDescription('View or change the schedule')
        .addSubcommand(subcommand => subcommand.setName('view').setDescription('View the current schedule'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('set')
                .setDescription('Set and enable a five-field cron schedule')
                .addStringOption(option =>
                    option.setName('cron').setDescription('Example: 0 7 * * *').setRequired(true)
                )
                .addBooleanOption(option =>
                    option.setName('confirm').setDescription('Confirm changing the schedule').setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('disable')
                .setDescription('Disable scheduled runs')
                .addBooleanOption(option =>
                    option.setName('confirm').setDescription('Confirm disabling the schedule').setRequired(true)
                )
        )
].map(command => command.toJSON())

function assertAllowed(interaction) {
    if (!allowedUsers.has(interaction.user.id)) throw new Error('You are not authorized to use this bot.')
}

function sanitize(value) {
    return String(value)
        .replace(/(password|passwd|token|cookie|secret|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .replace(/(ACCOUNT_\d+_(?:PASSWORD|TOTP_SECRET|PROXY_PASSWORD))=\S+/gi, '$1=[redacted]')
        .slice(0, 1800)
}

async function api(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {
        ...options,
        headers: { ...apiHeaders, ...(options.headers ?? {}) }
    })
    const text = await response.text()
    let body
    try {
        body = JSON.parse(text)
    } catch {
        body = { message: text }
    }
    if (!response.ok) throw new Error(body.error ?? `Control API returned HTTP ${response.status}`)
    return body
}

function jsonResponse(data) {
    return { content: `\`\`\`json\n${sanitize(JSON.stringify(data, null, 2))}\n\`\`\`` }
}

async function handle(interaction) {
    assertAllowed(interaction)
    const name = interaction.commandName
    if (name === 'status') return jsonResponse(await api('/status'))
    if (name === 'accounts') {
        const result = await api('/accounts')
        return jsonResponse({
            count: result.count,
            accounts: result.accounts.map(account => ({ email: account.email }))
        })
    }
    if (name === 'logs') {
        const limit = interaction.options.getInteger('limit') ?? 10
        const result = await api(`/logs?limit=${limit}`)
        return jsonResponse(result)
    }
    if (name === 'run') {
        if (!interaction.options.getBoolean('confirm')) throw new Error('Run not started: set confirm to true.')
        return jsonResponse(
            await api('/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        )
    }
    if (name === 'schedule') {
        const subcommand = interaction.options.getSubcommand()
        if (subcommand === 'view') return jsonResponse(await api('/schedule'))
        if (!interaction.options.getBoolean('confirm')) throw new Error('Schedule not changed: set confirm to true.')
        const body =
            subcommand === 'set' ? { enabled: true, cron: interaction.options.getString('cron') } : { enabled: false }
        return jsonResponse(
            await api('/schedule', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
        )
    }
    throw new Error('Unknown command.')
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })
client.once('ready', async readyClient => {
    const rest = new REST({ version: '10' }).setToken(token)
    await rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: commands })
    console.log(`[discord] Logged in as ${readyClient.user.tag}; commands registered for guild ${guildId}`)
})
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return
    try {
        await interaction.deferReply({ ephemeral: true })
        await interaction.editReply(await handle(interaction))
    } catch (error) {
        const message = sanitize(error instanceof Error ? error.message : String(error))
        if (interaction.deferred || interaction.replied) await interaction.editReply({ content: `Error: ${message}` })
        else await interaction.reply({ content: `Error: ${message}`, ephemeral: true })
    }
})
client.login(token)
