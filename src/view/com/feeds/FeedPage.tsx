import React from 'react'
import {useNavigation} from '@react-navigation/native'
import {useAnalytics} from 'lib/analytics/analytics'
import {useQueryClient} from '@tanstack/react-query'
import {RQKEY as FEED_RQKEY} from '#/state/queries/post-feed'
import {MainScrollProvider} from '../util/MainScrollProvider'
import {useWebMediaQueries} from 'lib/hooks/useWebMediaQueries'
import {useSetMinimalShellMode} from '#/state/shell'
import {FeedDescriptor, FeedParams} from '#/state/queries/post-feed'
import {ComposeIcon2} from 'lib/icons'
import {s} from 'lib/styles'
import {View, useWindowDimensions} from 'react-native'
import {ListMethods} from '../util/List'
import {Feed} from '../posts/Feed'
import {FAB} from '../util/fab/FAB'
import {LoadLatestBtn} from '../util/load-latest/LoadLatestBtn'
import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useSession} from '#/state/session'
import {useComposerControls} from '#/state/shell/composer'
import {listenSoftReset} from '#/state/events'
import {truncateAndInvalidate} from '#/state/queries/util'
import {TabState, getTabState, getRootNavigation} from '#/lib/routes/helpers'
import {isNative} from '#/platform/detection'

const POLL_FREQ = 60e3 // 60sec

export function FeedPage({
  testID,
  isPageFocused,
  feed,
  feedParams,
  renderEmptyState,
  renderEndOfFeed,
}: {
  testID?: string
  feed: FeedDescriptor
  feedParams?: FeedParams
  isPageFocused: boolean
  renderEmptyState: () => JSX.Element
  renderEndOfFeed?: () => JSX.Element
}) {
  const {hasSession} = useSession()
  const {_} = useLingui()
  const navigation = useNavigation()
  const queryClient = useQueryClient()
  const {openComposer} = useComposerControls()
  const [isScrolledDown, setIsScrolledDown] = React.useState(false)
  const setMinimalShellMode = useSetMinimalShellMode()
  const {screen, track} = useAnalytics()
  const headerOffset = useHeaderOffset()
  const scrollElRef = React.useRef<ListMethods>(null)
  const [hasNew, setHasNew] = React.useState(false)

  const scrollToTop = React.useCallback(() => {
    scrollElRef.current?.scrollToOffset({
      animated: isNative,
      offset: -headerOffset,
    })
    setMinimalShellMode(false)
  }, [headerOffset, setMinimalShellMode])

  const onSoftReset = React.useCallback(() => {
    const isScreenFocused =
      getTabState(getRootNavigation(navigation).getState(), 'Home') ===
      TabState.InsideAtRoot
    if (isScreenFocused && isPageFocused) {
      scrollToTop()
      truncateAndInvalidate(queryClient, FEED_RQKEY(feed))
      setHasNew(false)
    }
  }, [navigation, isPageFocused, scrollToTop, queryClient, feed, setHasNew])

  // fires when page within screen is activated/deactivated
  React.useEffect(() => {
    if (!isPageFocused) {
      return
    }
    screen('Feed')
    return listenSoftReset(onSoftReset)
  }, [onSoftReset, screen, isPageFocused])

  const onPressCompose = React.useCallback(() => {
    track('HomeScreen:PressCompose')
    openComposer({})
  }, [openComposer, track])

  const onPressLoadLatest = React.useCallback(() => {
    scrollToTop()
    truncateAndInvalidate(queryClient, FEED_RQKEY(feed))
    setHasNew(false)
  }, [scrollToTop, feed, queryClient, setHasNew])

  return (
    <View testID={testID} style={s.h100pct}>
      <MainScrollProvider>
        <Feed
          testID={testID ? `${testID}-feed` : undefined}
          enabled={isPageFocused}
          feed={feed}
          feedParams={feedParams}
          pollInterval={POLL_FREQ}
          disablePoll={hasNew}
          scrollElRef={scrollElRef}
          onScrolledDownChange={setIsScrolledDown}
          onHasNew={setHasNew}
          renderEmptyState={renderEmptyState}
          renderEndOfFeed={renderEndOfFeed}
          headerOffset={headerOffset}
        />
      </MainScrollProvider>
      {(isScrolledDown || hasNew) && (
        <LoadLatestBtn
          onPress={onPressLoadLatest}
          label={_(msg`Load new posts`)}
          showIndicator={hasNew}
        />
      )}

      {hasSession && (
        <FAB
          testID="composeFAB"
          onPress={onPressCompose}
          icon={<ComposeIcon2 strokeWidth={1.5} size={29} style={s.white} />}
          accessibilityRole="button"
          accessibilityLabel={_(msg({message: `New post`, context: 'action'}))}
          accessibilityHint=""
        />
      )}
    </View>
  )
}

function useHeaderOffset() {
  const {isDesktop, isTablet} = useWebMediaQueries()
  const {fontScale} = useWindowDimensions()
  if (isDesktop || isTablet) {
    return 0
  }
  const navBarHeight = 42
  const tabBarPad = 10 + 10 + 3 // padding + border
  const normalLineHeight = 1.2
  const tabBarText = 16 * normalLineHeight * fontScale
  return navBarHeight + tabBarPad + tabBarText
}
