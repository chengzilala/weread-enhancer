/**
 * 通用状态块：加载（骨架屏）/ 空态 / 错误 / 无 Key 引导
 *
 * 五个页面原本各写一份「加载中…」「去配置 Key」「重试」的重复结构，
 * 统一收敛到这里；页面只需给出文案与动作类型。
 */
Component({
  // 允许 app.wxss 的全局样式（如 .wre-btn）作用到组件内部
  options: { styleIsolation: 'apply-shared' },

  properties: {
    // 状态：loading / empty / error / nokey
    type: { type: String, value: 'loading' },
    // 主文案
    text: { type: String, value: '' },
    // 次文案（可选）
    sub: { type: String, value: '' },
    // 操作按钮文案；为空则不显示按钮
    action: { type: String, value: '' },
    // 操作类型：settings（去配置 Key）/ retry（重试）
    actionType: { type: String, value: 'retry' },
  },

  methods: {
    onAction() {
      this.triggerEvent('action', { type: this.data.actionType });
    },
  },
});
