import { ChatGPTPool } from "./chatgpt.js";
import { config } from "./config.js";
import { ContactInterface, RoomInterface } from "wechaty/impls";
import { Message } from "wechaty";
enum MessageType {
  Unknown = 0,

  Attachment = 1, // Attach(6),
  Audio = 2, // Audio(1), Voice(34)
  Contact = 3, // ShareCard(42)
  ChatHistory = 4, // ChatHistory(19)
  Emoticon = 5, // Sticker: Emoticon(15), Emoticon(47)
  Image = 6, // Img(2), Image(3)
  Text = 7, // Text(1)
  Location = 8, // Location(48)
  MiniProgram = 9, // MiniProgram(33)
  GroupNote = 10, // GroupNote(53)
  Transfer = 11, // Transfers(2000)
  RedEnvelope = 12, // RedEnvelopes(2001)
  Recalled = 13, // Recalled(10002)
  Url = 14, // Url(5)
  Video = 15, // Video(4), Video(43)
  Post = 16, // Moment, Channel, Tweet, etc
}

const SINGLE_MESSAGE_MAX_SIZE = 500;
export class ChatGPTBot {
  chatGPTPool = new ChatGPTPool();
  messageQueue: Message[] = []
  chatPrivateTriggerKeyword = config.chatPrivateTriggerKeyword;
  ready = false;
  botName: string = "";
  setBotName(botName: string) {
    this.botName = botName;
  }
  async startGPTBot() {
    console.debug(`Start GPT Bot Config is:${JSON.stringify(config)}`);
    await this.chatGPTPool.startPools();
    console.debug(`🤖️ Start GPT Bot Success, ready to handle message!`);
    this.ready = true;
  }
  // TODO: Add reset conversation id and ping pong
  async command(): Promise<void> { }
  /**
   * 格式化收到的消息
   * remove more text via - - - - - - - - - - - - - - -
   */
  cleanMessage(rawText: string): string {
    let text = rawText;
    const item = rawText.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) { // 回复类型的文本，要按斜杆分开
      text = item[item.length - 1];
    }
    text = text.replace(
      this.chatPrivateTriggerKeyword,
      ""
    );
    return text;
  }
  async getGPTMessage(text: string, talkerId: string): Promise<string> {
    return await this.chatGPTPool.sendMessage(text, talkerId);
  }
  /**
   * 获取发送实例
   */
  useSendItem(message: Message) {
    const talker = message.talker(); // 发送消息的人
    const room = message.room(); // 群聊
    const realText = this.cleanMessage(message.text()) // 实际处理的文本

    const responseObj = room
      ? room
      : talker.self() ? message.to() as ContactInterface : talker
  
    return { 
      conversionId: responseObj.id, // 对话id
      talker, // 发消息的人
      room, // 房间
      text: realText, // 真实交互的文本 
      responseObj, // 回复信息的对象
      say: (text: string, cut: boolean=true) => { // 发送消息
        const sendText = cut && realText.length > 15
          ?  `${realText.slice(0,12)}...\n- - - - -\n${text}` 
          : `${realText}\n ------\n${text}`
        return responseObj.say(sendText, talker)
      },
    }
  }
  /**
   * 判断是否是可触发消息类型
   */
  isNonsense(
    messageType: MessageType,
    text: string
  ): boolean {
    return (
      // TODO: add doc support
      messageType !== MessageType.Text ||
      // 语音(视频)消息
      text.includes("收到一条视频/语音聊天消息，请在手机上查看") ||
      // 红包消息
      text.includes("收到红包，请在手机上查看") ||
      // Transfer message
      text.includes("收到转账，请在手机上查看") ||
      // 位置消息
      text.includes("/cgi-bin/mmwebwx-bin/webwxgetpubliclinkimg")
    );
  }
  async onMessage() {
    const message = this.messageQueue[0]
    if (!message) return

    try {
      const { conversionId, say, text } = this.useSendItem(message)

      console.log(`处理这条消息: ${message}`)

      /* 发送提示消息 */
      await say("给我点时间思考一下")

      /* 发送消息 */
      const gptMessage = await this.getGPTMessage(text, conversionId);
      await say(gptMessage);

      console.log(`回复这条消息: ${message}`, this.messageQueue.length-1)
    } catch (err) {
      console.log(err)
    }

    /* 弹出当前消息 */
    this.messageQueue.shift()
    /* 递归执行一次发送 */
    this.onMessage()
  }
  /**
   * 预发送。把需要发送的消息放到队列里
   */
  async preSendMessage(message: Message) {
    const rawText = message.text();
    const messageType = message.type();

    /* 判断消息类型，如果不是合适类型则去掉 */
    if (this.isNonsense(messageType, rawText)) {
      return;
    }

    /* 判断消息是否满足关键词触发 */
    if (!rawText.startsWith(this.chatPrivateTriggerKeyword)) {
      return
    }

    const { conversionId, say, text } = this.useSendItem(message)

    /* 重置 */
    if(text.startsWith('reset')) {
      this.chatGPTPool.resetConversation(conversionId)
      say("♻️ 我们重新开始吧")
      return
    }

    this.messageQueue.push(message)

    if (this.messageQueue.length === 1) {
      await this.onMessage()
    } else {
      say(`稍等，前面还有${this.messageQueue.length - 1}个问题`)
    }
  }
}
