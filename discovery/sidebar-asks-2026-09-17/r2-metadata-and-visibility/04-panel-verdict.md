# R2-1 ④ 专家团评审

- 产品经理（John）：**同意**。条件：`maxDefaultVisible` 必须能在设置界面改，不能只改 bundle `cordis.yml`。
- 架构师（Winston）：**有保留**。icon/badge/order/visibility 无异议；但 `section?` + 新核心注册面违反 Rule of Three（只有一个引用方）⇒ 等第三个 owner 再抽象。
- 业务分析（Mary）：**有保留**。门禁几条可证伪、认可；但预算"3"与 0–999/1000+ 分段**无证据** ⇒ 要求现网 chip 实测数与分段签字人。

分歧（未抹平）：抽象时机 —— Winston 用 Rule of Three 挡分区注册面，John 认为整组元数据过度设计（V1 只留 visibility），Mary 只认门禁不认预算常数。
