import { CommandSleepTTL } from '@/constants'
import { CommandSleepService } from '@/core/commandSleep'
import { API } from '@/modules/API'
import { FeedbackEvaluation } from '@/types'
import { Injectable, Logger } from '@nestjs/common'
import { ChannelType, ChatInputCommandInteraction, Message } from 'discord.js'
import { FeedbackOptions } from './DTO/options.DTO'
import { FeedbackEmbeds } from './resources/feedback.embeds'

@Injectable()
export class FeedbackService {
  private _logger = new Logger(FeedbackService.name)
  private _embeds = new FeedbackEmbeds()
  private _commandSleep = new CommandSleepService()

  async onUseCommand(interaction: ChatInputCommandInteraction, { evaluation, message }: FeedbackOptions) {
    this._logger.log('-'.repeat(30))
    this._logger.log('Start: command feedback on use')

    // Check on sleep before use command, if user is in black list do not use command
    if (this._commandSleep.isMemberInBlackList(interaction.user.id)) {
      interaction
        .reply({
          embeds: [this._embeds.errorFeedbackSleepCommand()],
          ephemeral: true,
        })
        .finally(() => {
          this._logger.log('Finally: Command sleep for member', `Member id: ${interaction.user.id}`)
        })

      return
    }

    // Show action bot
    await interaction.deferReply({ ephemeral: true })

    const evaluationTransformed = Number(evaluation) as FeedbackEvaluation

    const { guildId: guildID } = interaction

    await API.guildAPIService.addGuild(guildID)

    // Get feedback channel ID from DB
    const feedbackChannelID = await API.guildAPIService.getFeedbackChannel(guildID)

    if (!feedbackChannelID) {
      this._logger.error('Feedback channel not found')
      interaction.editReply({
        embeds: [this._embeds.errorFeedbackChannelNotFound()],
      })

      return
    }

    // Get feedback channel
    const channel = await interaction.guild.channels.fetch(feedbackChannelID)

    // Check on text type channel
    if (channel?.type !== ChannelType.GuildText) {
      this._logger.error('Feedback channel is not a text channel')
      interaction.editReply({
        embeds: [this._embeds.error()],
      })

      return
    }

    // Save feedback
    const feedback = await API.feedbackAPIService.addFeedback(interaction.user.id, { message, evaluation: evaluationTransformed })

    // If feedback is not saved
    if (!feedback) {
      this._logger.error('Failed to save feedback')
      interaction.editReply({
        embeds: [this._embeds.error()],
      })

      return
    }

    // Send feedback
    const messageInChannel: Message | null = await channel
      .send({
        embeds: [this._embeds.feedback(interaction.user, { evaluation: evaluationTransformed, message })],
      })
      .then(message => {
        this._logger.log('Send feedback', `Member id: ${interaction.user.id}`, `Message id: ${message.id}`, `Channel id: ${channel.id}`)
        return message
      })
      .catch(err => {
        this._logger.error('Failed to send feedback', err)
        return null
      })

    if (!messageInChannel) return

    // Reply message if message in feedback channel
    if (interaction.channelId !== feedbackChannelID) {
      interaction.editReply({
        embeds: [this._embeds.successFeedbackLeave(messageInChannel.channelId, messageInChannel.id)],
      })
    } else {
      interaction.deleteReply()
    }

    // Save member in sleep list for command feedback
    this._commandSleep.addInBlackList(interaction.user.id, { ttl: CommandSleepTTL['6h'] })

    // Update message ID in feedback
    const result = await API.feedbackAPIService.updateFeedback(feedback.feedbackID, { messageID: messageInChannel.id })

    if (!result) {
      this._logger.error('Failed to save feedback in DB')
    }
  }
}
