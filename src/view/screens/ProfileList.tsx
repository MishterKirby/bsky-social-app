import React, {useCallback, useMemo} from 'react'
import {Pressable, StyleSheet, View} from 'react-native'
import {useFocusEffect, useIsFocused} from '@react-navigation/native'
import {NativeStackScreenProps, CommonNavigatorParams} from 'lib/routes/types'
import {useNavigation} from '@react-navigation/native'
import {FontAwesomeIcon} from '@fortawesome/react-native-fontawesome'
import {AppBskyGraphDefs, AtUri, RichText as RichTextAPI} from '@atproto/api'
import {useQueryClient} from '@tanstack/react-query'
import {PagerWithHeader} from 'view/com/pager/PagerWithHeader'
import {ProfileSubpageHeader} from 'view/com/profile/ProfileSubpageHeader'
import {Feed} from 'view/com/posts/Feed'
import {Text} from 'view/com/util/text/Text'
import {NativeDropdown, DropdownItem} from 'view/com/util/forms/NativeDropdown'
import {CenteredView} from 'view/com/util/Views'
import {EmptyState} from 'view/com/util/EmptyState'
import {LoadingScreen} from 'view/com/util/LoadingScreen'
import {RichText} from '#/components/RichText'
import {Button} from 'view/com/util/forms/Button'
import {TextLink} from 'view/com/util/Link'
import {ListRef} from 'view/com/util/List'
import * as Toast from 'view/com/util/Toast'
import {LoadLatestBtn} from 'view/com/util/load-latest/LoadLatestBtn'
import {FAB} from 'view/com/util/fab/FAB'
import {Haptics} from 'lib/haptics'
import {FeedDescriptor} from '#/state/queries/post-feed'
import {usePalette} from 'lib/hooks/usePalette'
import {useSetTitle} from 'lib/hooks/useSetTitle'
import {useWebMediaQueries} from 'lib/hooks/useWebMediaQueries'
import {RQKEY as FEED_RQKEY} from '#/state/queries/post-feed'
import {NavigationProp} from 'lib/routes/types'
import {toShareUrl} from 'lib/strings/url-helpers'
import {shareUrl} from 'lib/sharing'
import {s} from 'lib/styles'
import {sanitizeHandle} from 'lib/strings/handles'
import {makeProfileLink, makeListLink} from 'lib/routes/links'
import {ComposeIcon2} from 'lib/icons'
import {ListMembers} from '#/view/com/lists/ListMembers'
import {Trans, msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'
import {useSetMinimalShellMode} from '#/state/shell'
import {useModalControls} from '#/state/modals'
import {useResolveUriQuery} from '#/state/queries/resolve-uri'
import {
  useListQuery,
  useListMuteMutation,
  useListBlockMutation,
  useListDeleteMutation,
} from '#/state/queries/list'
import {cleanError} from '#/lib/strings/errors'
import {useSession} from '#/state/session'
import {useComposerControls} from '#/state/shell/composer'
import {isNative, isWeb} from '#/platform/detection'
import {truncateAndInvalidate} from '#/state/queries/util'
import {
  usePreferencesQuery,
  usePinFeedMutation,
  useUnpinFeedMutation,
  useSetSaveFeedsMutation,
} from '#/state/queries/preferences'
import {logger} from '#/logger'
import {useAnalytics} from '#/lib/analytics/analytics'
import {listenSoftReset} from '#/state/events'
import {atoms as a, useTheme} from '#/alf'

const SECTION_TITLES_CURATE = ['Posts', 'About']
const SECTION_TITLES_MOD = ['About']

interface SectionRef {
  scrollToTop: () => void
}

type Props = NativeStackScreenProps<CommonNavigatorParams, 'ProfileList'>
export function ProfileListScreen(props: Props) {
  const {_} = useLingui()
  const {name: handleOrDid, rkey} = props.route.params
  const {data: resolvedUri, error: resolveError} = useResolveUriQuery(
    AtUri.make(handleOrDid, 'app.bsky.graph.list', rkey).toString(),
  )
  const {data: list, error: listError} = useListQuery(resolvedUri?.uri)

  if (resolveError) {
    return (
      <CenteredView>
        <ErrorScreen
          error={_(
            msg`We're sorry, but we were unable to resolve this list. If this persists, please contact the list creator, @${handleOrDid}.`,
          )}
        />
      </CenteredView>
    )
  }
  if (listError) {
    return (
      <CenteredView>
        <ErrorScreen error={cleanError(listError)} />
      </CenteredView>
    )
  }

  return resolvedUri && list ? (
    <ProfileListScreenLoaded {...props} uri={resolvedUri.uri} list={list} />
  ) : (
    <LoadingScreen />
  )
}

function ProfileListScreenLoaded({
  route,
  uri,
  list,
}: Props & {uri: string; list: AppBskyGraphDefs.ListView}) {
  const {_} = useLingui()
  const queryClient = useQueryClient()
  const {openComposer} = useComposerControls()
  const setMinimalShellMode = useSetMinimalShellMode()
  const {rkey} = route.params
  const feedSectionRef = React.useRef<SectionRef>(null)
  const aboutSectionRef = React.useRef<SectionRef>(null)
  const {openModal} = useModalControls()
  const isCurateList = list.purpose === 'app.bsky.graph.defs#curatelist'
  const isScreenFocused = useIsFocused()

  useSetTitle(list.name)

  useFocusEffect(
    useCallback(() => {
      setMinimalShellMode(false)
    }, [setMinimalShellMode]),
  )

  const onPressAddUser = useCallback(() => {
    openModal({
      name: 'list-add-remove-users',
      list,
      onChange() {
        if (isCurateList) {
          truncateAndInvalidate(queryClient, FEED_RQKEY(`list|${list.uri}`))
        }
      },
    })
  }, [openModal, list, isCurateList, queryClient])

  const onCurrentPageSelected = React.useCallback(
    (index: number) => {
      if (index === 0) {
        feedSectionRef.current?.scrollToTop()
      } else if (index === 1) {
        aboutSectionRef.current?.scrollToTop()
      }
    },
    [feedSectionRef],
  )

  const renderHeader = useCallback(() => {
    return <Header rkey={rkey} list={list} />
  }, [rkey, list])

  if (isCurateList) {
    return (
      <View style={s.hContentRegion}>
        <PagerWithHeader
          items={SECTION_TITLES_CURATE}
          isHeaderReady={true}
          renderHeader={renderHeader}
          onCurrentPageSelected={onCurrentPageSelected}>
          {({headerHeight, scrollElRef, isFocused}) => (
            <FeedSection
              ref={feedSectionRef}
              feed={`list|${uri}`}
              scrollElRef={scrollElRef as ListRef}
              headerHeight={headerHeight}
              isFocused={isScreenFocused && isFocused}
            />
          )}
          {({headerHeight, scrollElRef}) => (
            <AboutSection
              ref={aboutSectionRef}
              scrollElRef={scrollElRef as ListRef}
              list={list}
              onPressAddUser={onPressAddUser}
              headerHeight={headerHeight}
            />
          )}
        </PagerWithHeader>
        <FAB
          testID="composeFAB"
          onPress={() => openComposer({})}
          icon={
            <ComposeIcon2
              strokeWidth={1.5}
              size={29}
              style={{color: 'white'}}
            />
          }
          accessibilityRole="button"
          accessibilityLabel={_(msg`New post`)}
          accessibilityHint=""
        />
      </View>
    )
  }
  return (
    <View style={s.hContentRegion}>
      <PagerWithHeader
        items={SECTION_TITLES_MOD}
        isHeaderReady={true}
        renderHeader={renderHeader}>
        {({headerHeight, scrollElRef}) => (
          <AboutSection
            list={list}
            scrollElRef={scrollElRef as ListRef}
            onPressAddUser={onPressAddUser}
            headerHeight={headerHeight}
          />
        )}
      </PagerWithHeader>
      <FAB
        testID="composeFAB"
        onPress={() => openComposer({})}
        icon={
          <ComposeIcon2 strokeWidth={1.5} size={29} style={{color: 'white'}} />
        }
        accessibilityRole="button"
        accessibilityLabel={_(msg`New post`)}
        accessibilityHint=""
      />
    </View>
  )
}

function Header({rkey, list}: {rkey: string; list: AppBskyGraphDefs.ListView}) {
  const pal = usePalette('default')
  const palInverted = usePalette('inverted')
  const {_} = useLingui()
  const navigation = useNavigation<NavigationProp>()
  const {currentAccount} = useSession()
  const {openModal, closeModal} = useModalControls()
  const listMuteMutation = useListMuteMutation()
  const listBlockMutation = useListBlockMutation()
  const listDeleteMutation = useListDeleteMutation()
  const isCurateList = list.purpose === 'app.bsky.graph.defs#curatelist'
  const isModList = list.purpose === 'app.bsky.graph.defs#modlist'
  const isBlocking = !!list.viewer?.blocked
  const isMuting = !!list.viewer?.muted
  const isOwner = list.creator.did === currentAccount?.did
  const {isPending: isPinPending, mutateAsync: pinFeed} = usePinFeedMutation()
  const {isPending: isUnpinPending, mutateAsync: unpinFeed} =
    useUnpinFeedMutation()
  const isPending = isPinPending || isUnpinPending
  const {data: preferences} = usePreferencesQuery()
  const {mutate: setSavedFeeds} = useSetSaveFeedsMutation()
  const {track} = useAnalytics()

  const isPinned = preferences?.feeds?.pinned?.includes(list.uri)
  const isSaved = preferences?.feeds?.saved?.includes(list.uri)

  const onTogglePinned = React.useCallback(async () => {
    Haptics.default()

    try {
      if (isPinned) {
        await unpinFeed({uri: list.uri})
      } else {
        await pinFeed({uri: list.uri})
      }
    } catch (e) {
      Toast.show(_(msg`There was an issue contacting the server`))
      logger.error('Failed to toggle pinned feed', {message: e})
    }
  }, [list.uri, isPinned, pinFeed, unpinFeed, _])

  const onSubscribeMute = useCallback(() => {
    openModal({
      name: 'confirm',
      title: _(msg`Mute these accounts?`),
      message: _(
        msg`Muting is private. Muted accounts can interact with you, but you will not see their posts or receive notifications from them.`,
      ),
      confirmBtnText: _(msg`Mute this List`),
      async onPressConfirm() {
        try {
          await listMuteMutation.mutateAsync({uri: list.uri, mute: true})
          Toast.show(_(msg`List muted`))
          track('Lists:Mute')
        } catch {
          Toast.show(
            _(
              msg`There was an issue. Please check your internet connection and try again.`,
            ),
          )
        }
      },
      onPressCancel() {
        closeModal()
      },
    })
  }, [openModal, closeModal, list, listMuteMutation, track, _])

  const onUnsubscribeMute = useCallback(async () => {
    try {
      await listMuteMutation.mutateAsync({uri: list.uri, mute: false})
      Toast.show(_(msg`List unmuted`))
      track('Lists:Unmute')
    } catch {
      Toast.show(
        _(
          msg`There was an issue. Please check your internet connection and try again.`,
        ),
      )
    }
  }, [list, listMuteMutation, track, _])

  const onSubscribeBlock = useCallback(() => {
    openModal({
      name: 'confirm',
      title: _(msg`Block these accounts?`),
      message: _(
        msg`Blocking is public. Blocked accounts cannot reply in your threads, mention you, or otherwise interact with you.`,
      ),
      confirmBtnText: _(msg`Block this List`),
      async onPressConfirm() {
        try {
          await listBlockMutation.mutateAsync({uri: list.uri, block: true})
          Toast.show(_(msg`List blocked`))
          track('Lists:Block')
        } catch {
          Toast.show(
            _(
              msg`There was an issue. Please check your internet connection and try again.`,
            ),
          )
        }
      },
      onPressCancel() {
        closeModal()
      },
    })
  }, [openModal, closeModal, list, listBlockMutation, track, _])

  const onUnsubscribeBlock = useCallback(async () => {
    try {
      await listBlockMutation.mutateAsync({uri: list.uri, block: false})
      Toast.show(_(msg`List unblocked`))
      track('Lists:Unblock')
    } catch {
      Toast.show(
        _(
          msg`There was an issue. Please check your internet connection and try again.`,
        ),
      )
    }
  }, [list, listBlockMutation, track, _])

  const onPressEdit = useCallback(() => {
    openModal({
      name: 'create-or-edit-list',
      list,
    })
  }, [openModal, list])

  const onPressDelete = useCallback(() => {
    openModal({
      name: 'confirm',
      title: _(msg`Delete List`),
      message: _(msg`Are you sure?`),
      async onPressConfirm() {
        await listDeleteMutation.mutateAsync({uri: list.uri})

        if (isSaved || isPinned) {
          const {saved, pinned} = preferences!.feeds

          setSavedFeeds({
            saved: isSaved ? saved.filter(uri => uri !== list.uri) : saved,
            pinned: isPinned ? pinned.filter(uri => uri !== list.uri) : pinned,
          })
        }

        Toast.show(_(msg`List deleted`))
        track('Lists:Delete')
        if (navigation.canGoBack()) {
          navigation.goBack()
        } else {
          navigation.navigate('Home')
        }
      },
    })
  }, [
    openModal,
    list,
    listDeleteMutation,
    navigation,
    track,
    _,
    preferences,
    isPinned,
    isSaved,
    setSavedFeeds,
  ])

  const onPressReport = useCallback(() => {
    openModal({
      name: 'report',
      uri: list.uri,
      cid: list.cid,
    })
  }, [openModal, list])

  const onPressShare = useCallback(() => {
    const url = toShareUrl(`/profile/${list.creator.did}/lists/${rkey}`)
    shareUrl(url)
    track('Lists:Share')
  }, [list, rkey, track])

  const dropdownItems: DropdownItem[] = useMemo(() => {
    let items: DropdownItem[] = [
      {
        testID: 'listHeaderDropdownShareBtn',
        label: isWeb ? _(msg`Copy link to list`) : _(msg`Share`),
        onPress: onPressShare,
        icon: {
          ios: {
            name: 'square.and.arrow.up',
          },
          android: '',
          web: 'share',
        },
      },
    ]
    if (isOwner) {
      items.push({label: 'separator'})
      items.push({
        testID: 'listHeaderDropdownEditBtn',
        label: _(msg`Edit list details`),
        onPress: onPressEdit,
        icon: {
          ios: {
            name: 'pencil',
          },
          android: '',
          web: 'pen',
        },
      })
      items.push({
        testID: 'listHeaderDropdownDeleteBtn',
        label: _(msg`Delete List`),
        onPress: onPressDelete,
        icon: {
          ios: {
            name: 'trash',
          },
          android: '',
          web: ['far', 'trash-can'],
        },
      })
    } else {
      items.push({label: 'separator'})
      items.push({
        testID: 'listHeaderDropdownReportBtn',
        label: _(msg`Report List`),
        onPress: onPressReport,
        icon: {
          ios: {
            name: 'exclamationmark.triangle',
          },
          android: '',
          web: 'circle-exclamation',
        },
      })
    }
    if (isModList && isPinned) {
      items.push({label: 'separator'})
      items.push({
        testID: 'listHeaderDropdownUnpinBtn',
        label: _(msg`Unpin moderation list`),
        onPress: isPending ? undefined : () => unpinFeed({uri: list.uri}),
        icon: {
          ios: {
            name: 'pin',
          },
          android: '',
          web: 'thumbtack',
        },
      })
    }
    if (isCurateList) {
      items.push({label: 'separator'})

      if (!isBlocking) {
        items.push({
          testID: 'listHeaderDropdownMuteBtn',
          label: isMuting ? _(msg`Un-mute list`) : _(msg`Mute list`),
          onPress: isMuting ? onUnsubscribeMute : onSubscribeMute,
          icon: {
            ios: {
              name: isMuting ? 'eye' : 'eye.slash',
            },
            android: '',
            web: isMuting ? 'eye' : ['far', 'eye-slash'],
          },
        })
      }

      if (!isMuting) {
        items.push({
          testID: 'listHeaderDropdownBlockBtn',
          label: isBlocking ? _(msg`Un-block list`) : _(msg`Block list`),
          onPress: isBlocking ? onUnsubscribeBlock : onSubscribeBlock,
          icon: {
            ios: {
              name: 'person.fill.xmark',
            },
            android: '',
            web: 'user-slash',
          },
        })
      }
    }
    return items
  }, [
    isOwner,
    onPressShare,
    onPressEdit,
    onPressDelete,
    onPressReport,
    _,
    isModList,
    isPinned,
    unpinFeed,
    isPending,
    list.uri,
    isCurateList,
    isMuting,
    isBlocking,
    onUnsubscribeMute,
    onSubscribeMute,
    onUnsubscribeBlock,
    onSubscribeBlock,
  ])

  const subscribeDropdownItems: DropdownItem[] = useMemo(() => {
    return [
      {
        testID: 'subscribeDropdownMuteBtn',
        label: _(msg`Mute accounts`),
        onPress: onSubscribeMute,
        icon: {
          ios: {
            name: 'speaker.slash',
          },
          android: '',
          web: 'user-slash',
        },
      },
      {
        testID: 'subscribeDropdownBlockBtn',
        label: _(msg`Block accounts`),
        onPress: onSubscribeBlock,
        icon: {
          ios: {
            name: 'person.fill.xmark',
          },
          android: '',
          web: 'ban',
        },
      },
    ]
  }, [onSubscribeMute, onSubscribeBlock, _])

  return (
    <ProfileSubpageHeader
      href={makeListLink(list.creator.handle || list.creator.did || '', rkey)}
      title={list.name}
      avatar={list.avatar}
      isOwner={list.creator.did === currentAccount?.did}
      creator={list.creator}
      avatarType="list">
      {isCurateList || isPinned ? (
        <Button
          testID={isPinned ? 'unpinBtn' : 'pinBtn'}
          type={isPinned ? 'default' : 'inverted'}
          label={isPinned ? _(msg`Unpin`) : _(msg`Pin to home`)}
          onPress={onTogglePinned}
          disabled={isPending}
        />
      ) : isModList ? (
        isBlocking ? (
          <Button
            testID="unblockBtn"
            type="default"
            label={_(msg`Unblock`)}
            onPress={onUnsubscribeBlock}
          />
        ) : isMuting ? (
          <Button
            testID="unmuteBtn"
            type="default"
            label={_(msg`Unmute`)}
            onPress={onUnsubscribeMute}
          />
        ) : (
          <NativeDropdown
            testID="subscribeBtn"
            items={subscribeDropdownItems}
            accessibilityLabel={_(msg`Subscribe to this list`)}
            accessibilityHint="">
            <View style={[palInverted.view, styles.btn]}>
              <Text style={palInverted.text}>
                <Trans>Subscribe</Trans>
              </Text>
            </View>
          </NativeDropdown>
        )
      ) : null}
      <NativeDropdown
        testID="headerDropdownBtn"
        items={dropdownItems}
        accessibilityLabel={_(msg`More options`)}
        accessibilityHint="">
        <View style={[pal.viewLight, styles.btn]}>
          <FontAwesomeIcon icon="ellipsis" size={20} color={pal.colors.text} />
        </View>
      </NativeDropdown>
    </ProfileSubpageHeader>
  )
}

interface FeedSectionProps {
  feed: FeedDescriptor
  headerHeight: number
  scrollElRef: ListRef
  isFocused: boolean
}
const FeedSection = React.forwardRef<SectionRef, FeedSectionProps>(
  function FeedSectionImpl({feed, scrollElRef, headerHeight, isFocused}, ref) {
    const queryClient = useQueryClient()
    const [hasNew, setHasNew] = React.useState(false)
    const [isScrolledDown, setIsScrolledDown] = React.useState(false)
    const isScreenFocused = useIsFocused()
    const {_} = useLingui()

    const onScrollToTop = useCallback(() => {
      scrollElRef.current?.scrollToOffset({
        animated: isNative,
        offset: -headerHeight,
      })
      queryClient.resetQueries({queryKey: FEED_RQKEY(feed)})
      setHasNew(false)
    }, [scrollElRef, headerHeight, queryClient, feed, setHasNew])
    React.useImperativeHandle(ref, () => ({
      scrollToTop: onScrollToTop,
    }))

    React.useEffect(() => {
      if (!isScreenFocused) {
        return
      }
      return listenSoftReset(onScrollToTop)
    }, [onScrollToTop, isScreenFocused])

    const renderPostsEmpty = useCallback(() => {
      return <EmptyState icon="feed" message={_(msg`This feed is empty!`)} />
    }, [_])

    return (
      <View>
        <Feed
          testID="listFeed"
          enabled={isFocused}
          feed={feed}
          pollInterval={60e3}
          disablePoll={hasNew}
          scrollElRef={scrollElRef}
          onHasNew={setHasNew}
          onScrolledDownChange={setIsScrolledDown}
          renderEmptyState={renderPostsEmpty}
          headerOffset={headerHeight}
        />
        {(isScrolledDown || hasNew) && (
          <LoadLatestBtn
            onPress={onScrollToTop}
            label={_(msg`Load new posts`)}
            showIndicator={hasNew}
          />
        )}
      </View>
    )
  },
)

interface AboutSectionProps {
  list: AppBskyGraphDefs.ListView
  onPressAddUser: () => void
  headerHeight: number
  scrollElRef: ListRef
}
const AboutSection = React.forwardRef<SectionRef, AboutSectionProps>(
  function AboutSectionImpl(
    {list, onPressAddUser, headerHeight, scrollElRef},
    ref,
  ) {
    const pal = usePalette('default')
    const t = useTheme()
    const {_} = useLingui()
    const {isMobile} = useWebMediaQueries()
    const {currentAccount} = useSession()
    const [isScrolledDown, setIsScrolledDown] = React.useState(false)
    const isCurateList = list.purpose === 'app.bsky.graph.defs#curatelist'
    const isOwner = list.creator.did === currentAccount?.did

    const descriptionRT = useMemo(
      () =>
        list.description
          ? new RichTextAPI({
              text: list.description,
              facets: list.descriptionFacets,
            })
          : undefined,
      [list],
    )

    const onScrollToTop = useCallback(() => {
      scrollElRef.current?.scrollToOffset({
        animated: isNative,
        offset: -headerHeight,
      })
    }, [scrollElRef, headerHeight])

    React.useImperativeHandle(ref, () => ({
      scrollToTop: onScrollToTop,
    }))

    const renderHeader = React.useCallback(() => {
      return (
        <View>
          <View
            style={[
              {
                borderTopWidth: 1,
                padding: isMobile ? 14 : 20,
                gap: 12,
              },
              pal.border,
            ]}>
            {descriptionRT ? (
              <RichText
                testID="listDescription"
                style={[a.text_md]}
                value={descriptionRT}
              />
            ) : (
              <Text
                testID="listDescriptionEmpty"
                type="lg"
                style={[{fontStyle: 'italic'}, pal.textLight]}>
                <Trans>No description</Trans>
              </Text>
            )}
            <Text type="md" style={[pal.textLight]} numberOfLines={1}>
              {isCurateList ? (
                isOwner ? (
                  <Trans>User list by you</Trans>
                ) : (
                  <Trans>
                    User list by{' '}
                    <TextLink
                      text={sanitizeHandle(list.creator.handle || '', '@')}
                      href={makeProfileLink(list.creator)}
                      style={pal.textLight}
                    />
                  </Trans>
                )
              ) : isOwner ? (
                <Trans>Moderation list by you</Trans>
              ) : (
                <Trans>
                  Moderation list by{' '}
                  <TextLink
                    text={sanitizeHandle(list.creator.handle || '', '@')}
                    href={makeProfileLink(list.creator)}
                    style={pal.textLight}
                  />
                </Trans>
              )}
            </Text>
          </View>
          <View
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: isMobile ? 14 : 20,
                paddingBottom: isMobile ? 14 : 18,
              },
            ]}>
            <Text type="lg-bold" style={t.atoms.text}>
              <Trans>Users</Trans>
            </Text>
            {isOwner && (
              <Pressable
                testID="addUserBtn"
                accessibilityRole="button"
                accessibilityLabel={_(msg`Add a user to this list`)}
                accessibilityHint=""
                onPress={onPressAddUser}
                style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                <FontAwesomeIcon
                  icon="user-plus"
                  color={pal.colors.link}
                  size={16}
                />
                <Text style={pal.link}>
                  <Trans>Add</Trans>
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )
    }, [
      isMobile,
      pal.border,
      pal.textLight,
      pal.colors.link,
      pal.link,
      descriptionRT,
      isCurateList,
      isOwner,
      list.creator,
      t.atoms.text,
      _,
      onPressAddUser,
    ])

    const renderEmptyState = useCallback(() => {
      return (
        <EmptyState
          icon="users-slash"
          message={_(msg`This list is empty!`)}
          style={{paddingTop: 40}}
        />
      )
    }, [_])

    return (
      <View>
        <ListMembers
          testID="listItems"
          list={list.uri}
          scrollElRef={scrollElRef}
          renderHeader={renderHeader}
          renderEmptyState={renderEmptyState}
          headerOffset={headerHeight}
          onScrolledDownChange={setIsScrolledDown}
        />
        {isScrolledDown && (
          <LoadLatestBtn
            onPress={onScrollToTop}
            label={_(msg`Scroll to top`)}
            showIndicator={false}
          />
        )}
      </View>
    )
  },
)

function ErrorScreen({error}: {error: string}) {
  const pal = usePalette('default')
  const navigation = useNavigation<NavigationProp>()
  const {_} = useLingui()
  const onPressBack = useCallback(() => {
    if (navigation.canGoBack()) {
      navigation.goBack()
    } else {
      navigation.navigate('Home')
    }
  }, [navigation])

  return (
    <View
      style={[
        pal.view,
        pal.border,
        {
          marginTop: 10,
          paddingHorizontal: 18,
          paddingVertical: 14,
          borderTopWidth: 1,
        },
      ]}>
      <Text type="title-lg" style={[pal.text, s.mb10]}>
        <Trans>Could not load list</Trans>
      </Text>
      <Text type="md" style={[pal.text, s.mb20]}>
        {error}
      </Text>

      <View style={{flexDirection: 'row'}}>
        <Button
          type="default"
          accessibilityLabel={_(msg`Go Back`)}
          accessibilityHint={_(msg`Return to previous page`)}
          onPress={onPressBack}
          style={{flexShrink: 1}}>
          <Text type="button" style={pal.text}>
            <Trans>Go Back</Trans>
          </Text>
        </Button>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 50,
    marginLeft: 6,
  },
})
