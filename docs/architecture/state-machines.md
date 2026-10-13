# State Machines

## Knowledge

`candidate → authoring → reviewing → approved → indexing → published → deprecated → retired`

## Skill

`requested → authoring → validating → reviewing → approved → beta → stable → withdrawn → retired`

## Job/Provider

`queued → running → succeeded | failed | unknown → reconciling`

状态转换必须有 actor、reason、revision 和 evidence。未知状态不能被自动标记为成功。
