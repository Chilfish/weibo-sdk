/**
 * 结构快照工具（ADR-011）：把可变值替换为类型占位符，只保留响应结构。
 *
 * 用于 E2E 快照（tests/e2e/*）与 ArchiveService 的上游漂移检测（A7）。
 * 可变值包括：带 token/签名 URL、计数、ID、坐标、日期字符串等。
 * 纯函数，不依赖类实例。
 */
export function stripVolatileKeys(obj: unknown, depth = 0): unknown {
  if (obj === null || obj === undefined)
    return obj
  if (Array.isArray(obj)) {
    return obj.length > 0 ? [stripVolatileKeys(obj[0], depth + 1)] : []
  }
  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(record)) {
      // 签名 URL
      if (typeof v === 'string' && (
        v.includes('Expires=') || v.includes('&ssig=') || v.includes('?KID=')
        || v.includes('imgbed') || v.includes('sinaimg')
      )) {
        out[k] = '<IMG_URL>'
        continue
      }
      // 可变数字：计数、ID、坐标、等级
      if (['followers_count', 'friends_count', 'statuses_count', 'attitudes_count', 'comments_count', 'reposts_count', 'reads_count', 'total_number', 'total_cnt', 'pic_num', 'mbrank', 'mbtype', 'svip', 'vvip', 'v_plus', 'user_ability', 'mlevel', 'mblog_vip_type', 'content_auth', 'is_show_bulletin', 'verified_type', 'verified_type_ext', 'user_type', 'planet_video', 'follow_me', 'following', 'special_follow', 'apply_scenario_flag', 'display_text_min_number', 'comment_permission_type', 'approval_comment_type', 'comment_sort_type', 'share_repost_type', 'mblogtype', 'repost_type', 'showFeedRepost', 'showFeedComment', 'pictureViewerSign', 'showPictureViewer', 'is_paid', 'isSinglePayAudio', 'isMarkdown', 'can_edit', 'can_remark', 'is_show_mixed', 'mixed_count', 'favorited', 'attitudes_status', 'number_display_strategy'].includes(k) && typeof v === 'number') {
        out[k] = '<NUM>'
        continue
      }
      // 可变 ID（数字或数字串）
      if (['id', 'idstr', 'mid', 'mblogid', 'rid', 'fid', 'oid', 'object_id', 'pic_id', 'page_id', 'media_id', 'video_object_id', 'containerid', 'cardid', 'lcardid', 'luicode', 'lfid', 'uicode'].includes(k) && (typeof v === 'number' || typeof v === 'string')) {
        out[k] = '<ID>'
        continue
      }
      // 可变数值：total, pc_new, edit_count
      if (['total', 'pc_new', 'edit_count', 'textLength', 'reads_count', 'since_id', 'status_visible'].includes(k) && (typeof v === 'number' || typeof v === 'string')) {
        out[k] = '<VAR>'
        continue
      }
      // 时间字符串
      if (['created_at', 'birthday', 'video_publish_time'].includes(k) && typeof v === 'string') {
        out[k] = '<DATE>'
        continue
      }
      // 坐标
      if (k === 'coordinates' && Array.isArray(v)) {
        out[k] = '<COORDS>'
        continue
      }
      // 可变内容
      if (['text', 'text_raw', 'region_name', 'source', 'screen_name', 'description', 'location', 'profile_url', 'cover_image_phone', 'desc_text', 'ip_location', 'verified_url', 'friend_info', 'display_text', 'blockText', 'url', 'scheme', 'long_url', 'short_url', 'ori_url', 'h5_target_url', 'topic_url', 'topic_title', 'url_title', 'page_title', 'page_url', 'page_pic', 'tag_name', 'tag_scheme', 'object_type', 'analysis_extra', 'mark', 'ext', 'code', 'act_code', 'act_type', 'source_text', 'readtimetype', 'mblog_feed_back_menus_format', 'number_display_strategy'].includes(k) && typeof v === 'string') {
        out[k] = '<STR>'
        continue
      }
      // 嵌套对象递归
      if (typeof v === 'object' && v !== null) {
        out[k] = stripVolatileKeys(v, depth + 1)
        continue
      }
      out[k] = v
    }
    return out
  }
  return obj
}
